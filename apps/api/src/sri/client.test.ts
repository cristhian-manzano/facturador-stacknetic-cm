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
import { http, HttpResponse } from "msw";
import { ulid } from "ulid";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { UpstreamError } from "@facturador/utils/errors";
import { verifyServiceJwt } from "@facturador/utils/service-jwt";

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
        // Disable retries so the test is deterministic and fast.
        retryBackoffMs: [],
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("retries on transient 5xx (503 thrice → final success on 4th attempt)", async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${BASE}/v1/_diag/retry`, () => {
        calls += 1;
        if (calls < 4) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const res = await sriCoreFetch<{ ok: boolean }>("/v1/_diag/retry", {
      companyId: COMPANY_ID,
      serviceJwtSecret: SECRET,
      baseUrl: BASE,
      // Short backoff vector so the test runs fast but still exercises
      // the full 3-retry budget (= 4 attempts total).
      retryBackoffMs: [1, 1, 1],
    });
    expect(calls).toBe(4);
    expect(res.body.ok).toBe(true);
  });

  it("does NOT retry on a 4xx response (terminal contract violation)", async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${BASE}/v1/_diag/4xx`, () => {
        calls += 1;
        return HttpResponse.json({ code: "sri.bad_request" }, { status: 400 });
      }),
    );
    await expect(
      sriCoreFetch("/v1/_diag/4xx", {
        companyId: COMPANY_ID,
        serviceJwtSecret: SECRET,
        baseUrl: BASE,
        retryBackoffMs: [1, 1, 1],
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toBe(1);
  });

  it("throws UpstreamError when schema parse fails on a 2xx body", async () => {
    mswServer.use(
      http.get(`${BASE}/v1/_diag/schema`, () =>
        HttpResponse.json({ unexpected: true }),
      ),
    );
    const schema = z.object({ ok: z.boolean() });
    await expect(
      sriCoreFetch("/v1/_diag/schema", {
        companyId: COMPANY_ID,
        serviceJwtSecret: SECRET,
        baseUrl: BASE,
        schema,
        retryBackoffMs: [],
      }),
    ).rejects.toMatchObject({ code: "sri.contract" });
  });

  it("returns the parsed body when schema.parse succeeds", async () => {
    mswServer.use(
      http.get(`${BASE}/v1/_diag/schema-ok`, () =>
        HttpResponse.json({ ok: true, n: 42 }),
      ),
    );
    const schema = z.object({ ok: z.boolean(), n: z.number() });
    const res = await sriCoreFetch<z.infer<typeof schema>>(
      "/v1/_diag/schema-ok",
      {
        companyId: COMPANY_ID,
        serviceJwtSecret: SECRET,
        baseUrl: BASE,
        schema,
        retryBackoffMs: [],
      },
    );
    expect(res.body).toEqual({ ok: true, n: 42 });
  });
});
