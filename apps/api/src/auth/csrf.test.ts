/**
 * Unit tests for CSRF helpers + `assertCsrf` middleware.
 *
 * Per TASKS-0010 §2.1 / §2.2 validation step:
 *   - `mintCsrfToken()` returns a 32-byte token (43-char base64url).
 *   - `hashCsrfToken(token)` is deterministic SHA-256 hex.
 *   - `assertCsrf` returns 403 on missing header, mismatching cookie/header,
 *     or mismatching stored hash; passes through on a valid triple.
 */
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "@facturador/utils/errors";
import { assertCsrf, hashCsrfToken, mintCsrfToken } from "./csrf.js";
import type { AuthenticatedSession } from "./types.js";

const stubSession = (csrfTokenHash: string): AuthenticatedSession => ({
  id: "01HXSESSIONULID00000000000",
  userId: "01HXUSER0000000000000000000",
  companyId: null,
  csrfTokenHash,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  lastSeenAt: new Date(),
});

const buildReq = (overrides: Partial<Request>): Request =>
  ({
    method: "POST",
    path: "/api/v1/widget",
    headers: {} as Record<string, string>,
    cookies: {},
    ...overrides,
    header(name: string) {
      const h = (overrides.headers ?? {}) as Record<string, string>;
      return h[name.toLowerCase()];
    },
  }) as unknown as Request;

const runMiddleware = (req: Request): Promise<unknown> =>
  new Promise<unknown>((resolve) => {
    const next: NextFunction = (err?: unknown) => {
      resolve(err);
    };
    // Cast to any because the middleware signature uses Request augmentation.
    (assertCsrf as unknown as (r: Request, s: Response, n: NextFunction) => void)(
      req,
      {} as Response,
      next,
    );
  });

describe("mintCsrfToken / hashCsrfToken", () => {
  it("mintCsrfToken returns a 43-char base64url string (32 bytes)", () => {
    const t = mintCsrfToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("two consecutive mintCsrfToken calls return distinct values", () => {
    expect(mintCsrfToken()).not.toBe(mintCsrfToken());
  });

  it("hashCsrfToken is deterministic SHA-256 hex (64 chars)", () => {
    const t = "stable-token-xyz";
    expect(hashCsrfToken(t)).toBe(hashCsrfToken(t));
    expect(hashCsrfToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashCsrfToken produces different hashes for different tokens", () => {
    expect(hashCsrfToken("a")).not.toBe(hashCsrfToken("b"));
  });
});

describe("assertCsrf middleware", () => {
  it("passes through on safe methods (GET)", () => {
    const next = vi.fn();
    (assertCsrf as unknown as (r: Request, s: Response, n: NextFunction) => void)(
      { method: "GET", path: "/api/v1/me" } as unknown as Request,
      {} as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("bypasses the login path", () => {
    const next = vi.fn();
    (assertCsrf as unknown as (r: Request, s: Response, n: NextFunction) => void)(
      { method: "POST", path: "/api/v1/auth/login" } as unknown as Request,
      {} as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("fails 403 when session is absent (defensive fallback)", async () => {
    const err = await runMiddleware(buildReq({}));
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).code).toBe("csrf.invalid");
    expect((err as ForbiddenError).status).toBe(403);
  });

  it("fails 403 when CSRF header is missing", async () => {
    const token = mintCsrfToken();
    const req = buildReq({
      cookies: { facturador_csrf: token },
      session: stubSession(hashCsrfToken(token)),
    });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("fails 403 when CSRF cookie is missing", async () => {
    const token = mintCsrfToken();
    const req = buildReq({
      headers: { "x-csrf-token": token } as Record<string, string>,
      session: stubSession(hashCsrfToken(token)),
    });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("fails 403 when header and cookie mismatch", async () => {
    const tokenA = mintCsrfToken();
    const tokenB = mintCsrfToken();
    const req = buildReq({
      cookies: { facturador_csrf: tokenA },
      headers: { "x-csrf-token": tokenB } as Record<string, string>,
      session: stubSession(hashCsrfToken(tokenA)),
    });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("fails 403 when cookie does not hash to the stored hash", async () => {
    const token = mintCsrfToken();
    const req = buildReq({
      cookies: { facturador_csrf: token },
      headers: { "x-csrf-token": token } as Record<string, string>,
      session: stubSession("0".repeat(64)), // wrong stored hash
    });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("passes through on a valid double-submit + matching stored hash", async () => {
    const token = mintCsrfToken();
    const req = buildReq({
      cookies: { facturador_csrf: token },
      headers: { "x-csrf-token": token } as Record<string, string>,
      session: stubSession(hashCsrfToken(token)),
    });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
  });
});
