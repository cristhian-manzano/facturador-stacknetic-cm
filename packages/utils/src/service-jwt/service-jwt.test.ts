/**
 * Unit tests for `service-jwt` helpers.
 *
 * Covers the PROMPT-0020 §6 + TASKS-0020 §3.1/§3.2 matrix:
 *   - Happy path: round-trip mint → verify with same secret.
 *   - `mintServiceJwt` rejects empty companyId / out-of-range ttl.
 *   - `verifyServiceJwt` rejects:
 *       - tampered signature              → bad_signature
 *       - expired token                   → expired
 *       - wrong audience                  → wrong_audience
 *       - wrong issuer                    → wrong_issuer
 *       - `alg: none` header              → wrong_alg / malformed
 *       - `alg: RS256` with HMAC secret   → wrong_alg
 *       - missing token                   → missing_token
 *   - Clock skew tolerance is respected (5 s window by default).
 *
 * No `process.env` access here — secrets are passed as strings.
 */
import { SignJWT } from "jose";
import { ulid } from "ulid";
import { describe, expect, it } from "vitest";

import {
  SERVICE_JWT_AUDIENCE,
  SERVICE_JWT_ISSUER,
  SERVICE_JWT_MAX_TTL_SECONDS,
  mintServiceJwt,
  verifyServiceJwt,
} from "./service-jwt.js";

const SECRET = "test-service-jwt-secret-32-bytes-of-entropy-dev-only";
const ALT_SECRET = "different-secret-must-not-verify-by-design______________";
const COMPANY_ID = "01HXYZ123ABCDEFGHJKMNPQRST";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("mintServiceJwt", () => {
  it("returns a valid HS256 token verifiable with the same secret", async () => {
    const token = await mintServiceJwt({ companyId: COMPANY_ID, secret: SECRET });
    expect(token.split(".")).toHaveLength(3);

    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.iss).toBe(SERVICE_JWT_ISSUER);
    expect(result.claims.aud).toBe(SERVICE_JWT_AUDIENCE);
    expect(result.claims.sub).toBe(COMPANY_ID);
    expect(result.claims.exp - result.claims.iat).toBe(SERVICE_JWT_MAX_TTL_SECONDS);
    expect(result.claims.jti).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
  });

  it("respects a custom ttl ≤ 60 s", async () => {
    const token = await mintServiceJwt({
      companyId: COMPANY_ID,
      secret: SECRET,
      ttlSeconds: 30,
    });
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.exp - result.claims.iat).toBe(30);
  });

  it("rejects ttl above the hard cap", async () => {
    await expect(
      mintServiceJwt({ companyId: COMPANY_ID, secret: SECRET, ttlSeconds: 61 }),
    ).rejects.toThrow(/ttlSeconds out of range/);
  });

  it("rejects empty companyId", async () => {
    await expect(mintServiceJwt({ companyId: "", secret: SECRET })).rejects.toThrow(/companyId/);
  });

  it("rejects empty secret", async () => {
    await expect(mintServiceJwt({ companyId: COMPANY_ID, secret: "" })).rejects.toThrow(/secret/);
  });

  it("uses an injected jti when provided", async () => {
    const jti = ulid();
    const token = await mintServiceJwt({
      companyId: COMPANY_ID,
      secret: SECRET,
      jti,
    });
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.jti).toBe(jti);
  });
});

describe("verifyServiceJwt — happy & negative paths", () => {
  it("rejects an empty token with missing_token", async () => {
    const result = await verifyServiceJwt({ token: "", secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_token");
  });

  it("rejects a token signed with a different secret as bad_signature", async () => {
    const token = await mintServiceJwt({ companyId: COMPANY_ID, secret: SECRET });
    const result = await verifyServiceJwt({ token, secret: ALT_SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a tampered signature", async () => {
    const token = await mintServiceJwt({ companyId: COMPANY_ID, secret: SECRET });
    // Flip the last byte of the signature segment.
    const parts = token.split(".");
    const last = parts[2] ?? "";
    const tampered = `${parts[0] ?? ""}.${parts[1] ?? ""}.${last.slice(0, -1)}${last.at(-1) === "A" ? "B" : "A"}`;
    const result = await verifyServiceJwt({ token: tampered, secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects an expired token", async () => {
    const nowMs = Date.now();
    const token = await mintServiceJwt({
      companyId: COMPANY_ID,
      secret: SECRET,
      ttlSeconds: 1,
      nowMs,
    });
    // Skip 1 hour ahead; well past the 5 s clock tolerance.
    const result = await verifyServiceJwt({
      token,
      secret: SECRET,
      nowMs: nowMs + 60 * 60 * 1000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });

  it("tolerates clock skew up to 5 s past expiry", async () => {
    const nowMs = Date.now();
    const token = await mintServiceJwt({
      companyId: COMPANY_ID,
      secret: SECRET,
      ttlSeconds: 1,
      nowMs,
    });
    // Token expires at iat+1; verify 4 s later — within 5 s tolerance.
    const result = await verifyServiceJwt({
      token,
      secret: SECRET,
      nowMs: nowMs + 4_000,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a token minted with the wrong audience", async () => {
    const key = enc(SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(SERVICE_JWT_ISSUER)
      .setAudience("not-sri-core")
      .setSubject(COMPANY_ID)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(key);
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("wrong_audience");
  });

  it("rejects a token minted with the wrong issuer", async () => {
    const key = enc(SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("not-api")
      .setAudience(SERVICE_JWT_AUDIENCE)
      .setSubject(COMPANY_ID)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(key);
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("wrong_issuer");
  });

  it("rejects a token whose subject is missing", async () => {
    const key = enc(SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(SERVICE_JWT_ISSUER)
      .setAudience(SERVICE_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(key);
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(false);
  });

  it("rejects a hand-crafted alg:none token (alg confusion)", async () => {
    // Manually build an alg:none JWT. `jose` MUST refuse to verify this
    // because we pass `algorithms: ["HS256"]`.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: SERVICE_JWT_ISSUER,
        aud: SERVICE_JWT_AUDIENCE,
        sub: COMPANY_ID,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30,
      }),
    ).toString("base64url");
    const token = `${header}.${payload}.`;
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["wrong_alg", "malformed", "bad_signature"]).toContain(result.reason);
  });

  it("rejects a token whose header claims alg:RS256 when verifying against HS256 only", async () => {
    // We can't actually sign with RS256 without a key pair, but we can
    // forge a header that *claims* RS256 and concatenate an HMAC-style
    // signature. `jose` rejects on the `algorithms` filter before any
    // signature work happens.
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: SERVICE_JWT_ISSUER,
        aud: SERVICE_JWT_AUDIENCE,
        sub: COMPANY_ID,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30,
      }),
    ).toString("base64url");
    const token = `${header}.${payload}.AAAA`;
    const result = await verifyServiceJwt({ token, secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["wrong_alg", "malformed", "bad_signature"]).toContain(result.reason);
  });

  it("rejects gibberish as malformed", async () => {
    const result = await verifyServiceJwt({ token: "not.a.jwt", secret: SECRET });
    expect(result.ok).toBe(false);
  });
});
