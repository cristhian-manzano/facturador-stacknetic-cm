/**
 * Service-to-service JWT helpers — HS256, 60 s max lifetime.
 *
 * Source of truth:
 *   - SPEC-0020 §6.3 (claims contract).
 *   - PLAN-0020 §3 + Phase 2 (rotation rules).
 *   - TASKS-0020 §3 (mintServiceJwt / verifyServiceJwt).
 *   - PROMPT-0020 §6 (security policy — clockTolerance ≤ 5 s, no alg
 *     confusion).
 *   - ai/context/security.md (REDACT_PATHS covers `SERVICE_JWT_SECRET`).
 *
 * Wire shape (every claim asserted on both sides):
 *
 * ```jsonc
 * {
 *   "iss": "api",
 *   "aud": "sri-core",
 *   "sub": "<companyId>",   // 26-char ULID
 *   "iat": <epoch>,
 *   "exp": <epoch + 60>,    // ≤ 60 s lifetime (hard cap)
 *   "jti": "<ulid>"         // not currently checked against replay,
 *                           // but logged on the receiving side
 * }
 * ```
 *
 * Algorithm policy:
 *   - HS256 only. `verifyServiceJwt` passes `algorithms: ["HS256"]` to
 *     `jose.jwtVerify`. `jose` rejects `alg: none` by default and refuses
 *     to verify a header whose `alg` is outside the allow-list — both
 *     `alg: none` and `alg: RS256` (with the HMAC secret as the public key)
 *     fail before any signature work.
 *
 * Secret format:
 *   - Caller passes a string secret loaded by their `env.ts`. The HS256
 *     key is the raw UTF-8 bytes of that string — `jose` accepts a
 *     `Uint8Array` directly, so we encode once at the boundary.
 *   - SPEC-0003 §6.2 nominates a base64-encoded 256-bit secret in
 *     `.env`, but the bytes-of-the-string view is what matters for HS256
 *     and is what `mintServiceJwt` + `verifyServiceJwt` use consistently.
 *
 * NOTE: this helper is library code — it MUST NOT touch `process.env`.
 * Both apps construct it via their env loader and inject the secret.
 */

import { SignJWT, jwtVerify } from "jose";
import { ulid } from "ulid";

export const SERVICE_JWT_ISSUER = "api";
export const SERVICE_JWT_AUDIENCE = "sri-core";
/** Hard cap from SPEC-0020 §6.3. */
export const SERVICE_JWT_MAX_TTL_SECONDS = 60;
/** Per PROMPT-0020 §6, clock skew tolerance ≤ 5 s on the verify side. */
export const SERVICE_JWT_CLOCK_TOLERANCE_SECONDS = 5;

/** Resolved service-JWT claims. `sub` is the requesting tenant's companyId. */
export interface ServiceJwtClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti?: string;
}

export interface MintServiceJwtInput {
  /** Tenant whose request is being made. Must be a non-empty string ULID. */
  readonly companyId: string;
  /**
   * Raw secret bytes view (UTF-8 encoded). Caller is responsible for
   * loading + validating this through their env loader.
   */
  readonly secret: string;
  /**
   * Token lifetime in seconds. Defaults to {@link SERVICE_JWT_MAX_TTL_SECONDS}.
   * Values above the cap throw — the policy is "≤ 60 s" not "we trim it".
   */
  readonly ttlSeconds?: number;
  /**
   * Override the clock for tests. Defaults to `Date.now()`.
   * `now` is expressed in **milliseconds since the epoch** for parity with
   * `Date.now()`; the helper converts internally.
   */
  readonly nowMs?: number;
  /**
   * Override the `jti` for tests. Defaults to a fresh ULID.
   */
  readonly jti?: string;
}

function encodeSecret(secret: string): Uint8Array {
  if (secret.length === 0) {
    throw new Error("[service-jwt] secret must not be empty");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a service-to-service JWT (HS256, 60 s lifetime by default).
 *
 * The function is synchronous from the caller's point of view but
 * `jose.SignJWT` resolves a microtask-async signature; we await it inside.
 */
export async function mintServiceJwt(input: MintServiceJwtInput): Promise<string> {
  if (input.companyId.length === 0) {
    throw new Error("[service-jwt] companyId must not be empty");
  }
  const ttl = input.ttlSeconds ?? SERVICE_JWT_MAX_TTL_SECONDS;
  if (ttl <= 0 || ttl > SERVICE_JWT_MAX_TTL_SECONDS) {
    throw new Error(
      `[service-jwt] ttlSeconds out of range (1..${String(SERVICE_JWT_MAX_TTL_SECONDS)})`,
    );
  }
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const key = encodeSecret(input.secret);
  const jti = input.jti ?? ulid();

  return await new SignJWT({ jti })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SERVICE_JWT_ISSUER)
    .setAudience(SERVICE_JWT_AUDIENCE)
    .setSubject(input.companyId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttl)
    .setJti(jti)
    .sign(key);
}

export interface VerifyServiceJwtInput {
  readonly token: string;
  readonly secret: string;
  /** Override now for tests; epoch milliseconds. */
  readonly nowMs?: number;
  /**
   * Override clock tolerance in seconds. Defaults to
   * {@link SERVICE_JWT_CLOCK_TOLERANCE_SECONDS}.
   */
  readonly clockToleranceSeconds?: number;
}

export type VerifyServiceJwtResult =
  | { readonly ok: true; readonly claims: ServiceJwtClaims }
  | { readonly ok: false; readonly reason: VerifyFailureReason };

export type VerifyFailureReason =
  | "missing_token"
  | "malformed"
  | "wrong_alg"
  | "bad_signature"
  | "expired"
  | "wrong_issuer"
  | "wrong_audience"
  | "missing_subject";

/**
 * Verify a service-to-service JWT minted by {@link mintServiceJwt}.
 *
 * Returns a tagged result so the caller can map to a `ProblemDetail` /
 * status without re-parsing exceptions. On the unhappy path the failure
 * reason is intentionally coarse-grained (we never leak why exactly the
 * token was rejected to the wire — the middleware translates every
 * reason to a single 401).
 */
export async function verifyServiceJwt(
  input: VerifyServiceJwtInput,
): Promise<VerifyServiceJwtResult> {
  if (input.token.length === 0) {
    return { ok: false, reason: "missing_token" };
  }
  const key = encodeSecret(input.secret);
  const clockTolerance = input.clockToleranceSeconds ?? SERVICE_JWT_CLOCK_TOLERANCE_SECONDS;

  try {
    const { payload, protectedHeader } = await jwtVerify(input.token, key, {
      algorithms: ["HS256"],
      issuer: SERVICE_JWT_ISSUER,
      audience: SERVICE_JWT_AUDIENCE,
      clockTolerance,
      // `currentDate` is `Date` (not `Date | undefined`) under
      // exactOptionalPropertyTypes. Only attach the key when we actually
      // want to override the clock — tests pass `nowMs` explicitly.
      ...(input.nowMs === undefined ? {} : { currentDate: new Date(input.nowMs) }),
    });

    // Defence in depth: `jose` already enforces `algorithms`, but assert
    // here too so a copy-paste of this function elsewhere stays safe.
    if (protectedHeader.alg !== "HS256") {
      return { ok: false, reason: "wrong_alg" };
    }
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return { ok: false, reason: "missing_subject" };
    }
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      return { ok: false, reason: "malformed" };
    }

    const claims: ServiceJwtClaims = {
      iss: SERVICE_JWT_ISSUER,
      aud: SERVICE_JWT_AUDIENCE,
      sub: payload.sub,
      iat: payload.iat,
      exp: payload.exp,
      ...(typeof payload.jti === "string" ? { jti: payload.jti } : {}),
    };
    return { ok: true, claims };
  } catch (err) {
    return { ok: false, reason: classifyError(err) };
  }
}

function classifyError(err: unknown): VerifyFailureReason {
  const name = (err as { code?: string; name?: string }).code ?? (err as Error).name ?? "";
  if (name.includes("ERR_JWT_EXPIRED")) return "expired";
  if (name.includes("ERR_JWT_CLAIM_VALIDATION_FAILED")) {
    const claim = (err as { claim?: string }).claim;
    if (claim === "iss") return "wrong_issuer";
    if (claim === "aud") return "wrong_audience";
    if (claim === "sub") return "missing_subject";
    return "malformed";
  }
  if (name.includes("ERR_JWS_SIGNATURE_VERIFICATION_FAILED")) return "bad_signature";
  if (name.includes("ERR_JOSE_ALG_NOT_ALLOWED")) return "wrong_alg";
  if (name.includes("ERR_JWS_INVALID")) return "malformed";
  if (name.includes("ERR_JWT_INVALID")) return "malformed";
  return "malformed";
}
