/**
 * Unit tests for `apps/api/src/sri/client.ts`.
 *
 * Covers:
 *   - `mintServiceJwt` produces a token verifiable by the @facturador/utils
 *     verifier (round-trip).
 *   - `sriCoreFetch` attaches the `Authorization: Bearer <jwt>` header.
 *   - `sriCoreFetch` forwards `X-Request-Id` when provided.
 *   - `sriCoreFetch` throws `UpstreamError` on non-2xx.
 *
 * We intercept fetch via the MSW server already wired by the api test
 * setup, so the test doesn't open any real socket.
 */
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { ulid } from "ulid";
import { verifyServiceJwt } from "@facturador/utils/service-jwt";
import { UpstreamError } from "@facturador/utils/errors";
import { mswServer } from "../../test/msw/server.js";
import { mintServiceJwt, sriCoreFetch } from "./client.js";

const SECRET = "test-secret-for-api-sri-client-32+-chars-of-entropy_____";
const COMPANY_ID = ulid();
const BASE = "http://sri-core.test";

describe("mintServiceJwt", () => {
  it("round-trips with @facturador/utils/service-jwt", async () => {
    const token = await mintServiceJwt({ companyId: COMPANY_ID, secret: SECRET });
    const verified = await verifyServiceJwt({ token, secret: SECRET });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.sub).toBe(COMPANY_ID);
    expect(verified.claims.iss).toBe("api");
    expect(verified.claims.aud).toBe("sri-core");
  });
});

describe("sriCoreFetch", () => {
  it("attaches Authorization: Bearer <jwt>", async () => {
    let captured: { auth: string | null; reqId: string | null } = {
      auth: null,
      reqId: null,
    };
    mswServer.use(
      http.get(`${BASE}/v1/_diag/test`, ({ request }) => {
        captured = {
          auth: request.headers.get("authorization"),
          reqId: request.headers.get("x-request-id"),
        };
        return HttpResponse.json({ ok: true });
      }),
    );
    const res = await sriCoreFetch<{ ok: boolean }>("/v1/_diag/test", {
      companyId: COMPANY_ID,
      serviceJwtSecret: SECRET,
      baseUrl: BASE,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(captured.auth).toMatch(/^Bearer .+\..+\..+$/);
    // The token should verify with the shared secret.
    const token = (captured.auth ?? "").slice("Bearer ".length);
    const verified = await verifyServiceJwt({ token, secret: SECRET });
    expect(verified.ok).toBe(true);
  });

  it("forwards X-Request-Id when provided", async () => {
    let captured: string | null = null;
    mswServer.use(
      http.get(`${BASE}/v1/_diag/rid`, ({ request }) => {
        captured = request.headers.get("x-request-id");
        return HttpResponse.json({ ok: true });
      }),
    );
    const rid = ulid();
    await sriCoreFetch("/v1/_diag/rid", {
      companyId: COMPANY_ID,
      serviceJwtSecret: SECRET,
      baseUrl: BASE,
      requestId: rid,
    });
    expect(captured).toBe(rid);
  });

  it("throws UpstreamError on a non-2xx response", async () => {
    mswServer.use(
      http.post(`${BASE}/v1/_diag/fail`, () =>
        HttpResponse.json(
          { type: "urn:facturador:error:sri", code: "sri.devuelta", status: 422 },
          { status: 422 },
        ),
      ),
    );
    await expect(
      sriCoreFetch("/v1/_diag/fail", {
        companyId: COMPANY_ID,
        serviceJwtSecret: SECRET,
        baseUrl: BASE,
        method: "POST",
        body: { hello: "world" },
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws UpstreamError on a network failure", async () => {
    mswServer.use(http.get(`${BASE}/v1/_diag/network`, () => HttpResponse.error()));
    await expect(
      sriCoreFetch("/v1/_diag/network", {
        companyId: COMPANY_ID,
        serviceJwtSecret: SECRET,
        baseUrl: BASE,
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});
