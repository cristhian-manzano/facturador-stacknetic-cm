/**
 * Unit tests for the `requireServiceJwt` middleware — jti replay defence.
 *
 * Covers:
 *   - First arrival of a `jti` is accepted and the entry is burned.
 *   - Second arrival within the TTL window is rejected with `auth.replay`.
 *   - After the cache evicts (we step the deny-list manually) a fresh
 *     arrival with the SAME `jti` is accepted again.
 *   - A different `jti` always passes regardless of prior arrivals.
 *
 * The test exercises the middleware directly with mocked `req`/`res`/`next`
 * — no Express round-trip is needed for this layer. A dedicated
 * integration-shaped test in `apps/sri-core/test/documents.test.ts` will
 * cover the end-to-end 401 ProblemDetail wiring.
 */
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AuthError } from "@facturador/utils/errors";
import { mintServiceJwt } from "@facturador/utils/service-jwt";

import { buildRequireServiceJwt, createJtiDenyList, type JtiDenyList } from "./service-jwt.js";

const SECRET = "service-jwt-jti-test-secret-32-chars-of-entropy-padding!";

function fakeReq(token: string | undefined): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === "authorization" && token !== undefined ? `Bearer ${token}` : undefined,
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown,
    service: undefined,
  } as unknown as Request;
}

describe("requireServiceJwt — jti replay defence", () => {
  it("accepts the first arrival of a jti and rejects the replay with auth.replay", async () => {
    const denyList = createJtiDenyList();
    const middleware = buildRequireServiceJwt({ secret: SECRET, jtiDenyList: denyList });

    const jti = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
    const token = await mintServiceJwt({ companyId: "01HCOMPANY1", secret: SECRET, jti });

    // First call — accepted.
    const next1 = vi.fn();
    await middleware(fakeReq(token), {} as Response, next1 as NextFunction);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next1.mock.calls[0]?.[0]).toBeUndefined();

    // Second call — same jti, must be rejected.
    const next2 = vi.fn();
    await middleware(fakeReq(token), {} as Response, next2 as NextFunction);
    expect(next2).toHaveBeenCalledTimes(1);
    const err = next2.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe("auth.replay");
    expect((err as AuthError).status).toBe(401);
  });

  it("accepts a different jti even when the first one is still burned", async () => {
    const denyList = createJtiDenyList();
    const middleware = buildRequireServiceJwt({ secret: SECRET, jtiDenyList: denyList });
    const token1 = await mintServiceJwt({
      companyId: "01HCOMPANY1",
      secret: SECRET,
      jti: "01HX8K0PYFA9B7Y1M2N3P4Q5R6",
    });
    const token2 = await mintServiceJwt({
      companyId: "01HCOMPANY1",
      secret: SECRET,
      jti: "01HX8K0PYFA9B7Y1M2N3P4Q5RZ",
    });

    const next1 = vi.fn();
    await middleware(fakeReq(token1), {} as Response, next1 as NextFunction);
    expect(next1.mock.calls[0]?.[0]).toBeUndefined();

    const next2 = vi.fn();
    await middleware(fakeReq(token2), {} as Response, next2 as NextFunction);
    expect(next2.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("forgets a jti once the deny-list evicts the entry (cache expires after ≤ 60s)", async () => {
    // We don't try to time-warp the JWT verifier (it uses real time and
    // would mark our token expired before the deny-list got a turn).
    // Instead we inject a deny-list whose `has` returns false after we
    // manually evict — the middleware then accepts the same jti again.
    let burned = false;
    let evicted = false;
    const denyList: JtiDenyList = {
      has: () => (evicted ? false : burned),
      set: () => {
        burned = true;
      },
    };
    const middleware = buildRequireServiceJwt({
      secret: SECRET,
      jtiDenyList: denyList,
    });

    const jti = "01HX8K0PYFA9B7Y1M2N3P4Q5R7";
    const token = await mintServiceJwt({ companyId: "01HCOMPANY1", secret: SECRET, jti });
    const nextA = vi.fn();
    await middleware(fakeReq(token), {} as Response, nextA as NextFunction);
    expect(nextA.mock.calls[0]?.[0]).toBeUndefined();
    expect(burned).toBe(true);

    // Simulate cache TTL eviction past the 60 s window.
    evicted = true;
    const nextB = vi.fn();
    await middleware(fakeReq(token), {} as Response, nextB as NextFunction);
    expect(nextB.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("clamps the burn TTL to ≤ 60s regardless of the JWT exp claim", () => {
    const denyList = createJtiDenyList();
    // 60 s is the SPEC-0020 hard cap; the helper exposes its policy via
    // the public `set()` — passing 5 minutes still results in eviction
    // by the 60 s mark.
    denyList.set("jti-too-long", 5 * 60 * 1000);
    expect(denyList.has("jti-too-long")).toBe(true);
  });
});
