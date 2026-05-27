/**
 * Unit tests for the cookie helpers (apps/api/src/auth/cookies.ts).
 *
 * Per TASKS-0010 §1.1 validation step:
 *   - Naming branches on `NODE_ENV` (prod uses `__Host-` prefix).
 *   - Attribute matrix matches SPEC-0010 §6.2.
 *
 * The pure builders (`buildSessionCookieName`, etc.) are exercised for
 * both branches; the public side-effecting helpers are exercised against
 * a stub `Response` for the dev branch (the test runner sets
 * NODE_ENV=test, which behaves identically to dev for cookie naming).
 */
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import {
  buildCsrfCookieName,
  buildCsrfCookieOptions,
  buildSessionCookieName,
  buildSessionCookieOptions,
  clearSessionCookies,
  csrfCookieName,
  readCsrfCookie,
  readSessionCookie,
  sessionCookieName,
  setSessionCookies,
} from "./cookies.js";

interface FakeRes {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
}

const makeRes = (): FakeRes => ({
  cookie: vi.fn(),
  clearCookie: vi.fn(),
});

describe("apps/api/auth/cookies — pure builders", () => {
  it("uses plain names in non-production", () => {
    expect(buildSessionCookieName(false)).toBe("facturador_session");
    expect(buildCsrfCookieName(false)).toBe("facturador_csrf");
  });

  it("uses __Host- prefix in production", () => {
    expect(buildSessionCookieName(true)).toBe("__Host-facturador_session");
    expect(buildCsrfCookieName(true)).toBe("__Host-facturador_csrf");
  });

  it("session cookie is HttpOnly; CSRF is not", () => {
    expect(buildSessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
    expect(buildCsrfCookieOptions(false)).toMatchObject({
      httpOnly: false,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });

  it("production sets Secure on both cookies", () => {
    expect(buildSessionCookieOptions(true).secure).toBe(true);
    expect(buildCsrfCookieOptions(true).secure).toBe(true);
    // HttpOnly stays the same regardless of NODE_ENV.
    expect(buildSessionCookieOptions(true).httpOnly).toBe(true);
    expect(buildCsrfCookieOptions(true).httpOnly).toBe(false);
  });
});

describe("apps/api/auth/cookies — public helpers (NODE_ENV=test)", () => {
  it("readers return undefined when cookies are absent or malformed", () => {
    const req = {} as Request;
    expect(readSessionCookie(req)).toBeUndefined();
    expect(readCsrfCookie(req)).toBeUndefined();

    const req2 = {
      cookies: { facturador_session: "", facturador_csrf: 123 },
    } as unknown as Request;
    expect(readSessionCookie(req2)).toBeUndefined();
    expect(readCsrfCookie(req2)).toBeUndefined();
  });

  it("readers extract the cookie value when present", () => {
    const req = {
      cookies: {
        facturador_session: "01HXSESSIONULID00000000000",
        facturador_csrf: "csrf-value-here",
      },
    } as unknown as Request;
    expect(readSessionCookie(req)).toBe("01HXSESSIONULID00000000000");
    expect(readCsrfCookie(req)).toBe("csrf-value-here");
  });

  it("sessionCookieName/csrfCookieName return the plain dev/test names", () => {
    expect(sessionCookieName()).toBe("facturador_session");
    expect(csrfCookieName()).toBe("facturador_csrf");
  });

  it("setSessionCookies writes both cookies with the dev/test attribute matrix", () => {
    const res = makeRes();
    setSessionCookies(res as unknown as Response, {
      sessionId: "01HX0000000000000000000000",
      csrfToken: "test-csrf-token-base64url",
    });

    expect(res.cookie).toHaveBeenCalledTimes(2);
    const [sessionCall, csrfCall] = res.cookie.mock.calls as [
      [string, string, Record<string, unknown>],
      [string, string, Record<string, unknown>],
    ];

    expect(sessionCall[0]).toBe("facturador_session");
    expect(sessionCall[1]).toBe("01HX0000000000000000000000");
    expect(sessionCall[2]).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    expect(csrfCall[0]).toBe("facturador_csrf");
    expect(csrfCall[1]).toBe("test-csrf-token-base64url");
    expect(csrfCall[2]).toMatchObject({
      httpOnly: false,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });

  it("clearSessionCookies removes both cookies", () => {
    const res = makeRes();
    clearSessionCookies(res as unknown as Response);
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    const [first, second] = res.clearCookie.mock.calls as [[string], [string]];
    expect(first[0]).toBe("facturador_session");
    expect(second[0]).toBe("facturador_csrf");
  });
});
