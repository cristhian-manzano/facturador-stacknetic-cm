/**
 * `apiFetch` integration tests (TASKS-0040 §6.1, SPEC-0040 §6.2).
 *
 * Uses MSW to stub every HTTP call so no real network is touched
 * (PROMPT-0007 §2 "no real network"). Cookies are simulated by
 * writing to `document.cookie` — jsdom permits this for non-`HttpOnly`
 * cookies, which matches the production CSRF cookie behaviour.
 *
 * Coverage matrix:
 *   - 200 happy path with schema validation
 *   - 200 schema mismatch → ApiError("schema.mismatch")
 *   - 204 No Content → returns undefined
 *   - 400 with ProblemDetail body → ApiError, problem.errors preserved
 *   - 401 → dispatches "auth:401" event, ApiError thrown
 *   - 403 → dispatches "auth:403" event
 *   - 500 non-JSON body → ApiError("http.unexpected")
 *   - POST with CSRF cookie → X-CSRF-Token header attached
 *   - POST without CSRF cookie → header omitted, request still goes out
 *   - GET does NOT attach CSRF header even if cookie present
 *   - Network failure → ApiError("network.unexpected")
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { z } from "zod";

import { mswServer } from "../../test/msw/server.js";
import { ApiError, AUTH_EVENT_FORBIDDEN, AUTH_EVENT_UNAUTHORIZED, apiFetch } from "./api.js";

// `env.VITE_API_BASE_URL` defaults to "" in the test env, so apiFetch passes
// the relative path `/api/v1/...` to `fetch`. jsdom resolves that against
// the current `window.location.origin` (http://localhost). MSW supports
// matching relative paths regardless of origin, which is what we use below.

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookies(): void {
  for (const c of document.cookie.split("; ")) {
    const [k] = c.split("=");
    if (k !== undefined && k.length > 0) {
      document.cookie = `${k}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

const OkSchema = z.object({ id: z.string(), kind: z.literal("ok") });

beforeEach(() => {
  clearCookies();
});

afterEach(() => {
  clearCookies();
});

describe("apiFetch — happy path", () => {
  it("returns schema-validated body on 200", async () => {
    mswServer.use(http.get("/api/v1/things/42", () => HttpResponse.json({ id: "42", kind: "ok" })));

    const result = await apiFetch("/api/v1/things/42", { schema: OkSchema });
    expect(result).toEqual({ id: "42", kind: "ok" });
  });

  it("returns undefined for 204 No Content", async () => {
    mswServer.use(http.post("/api/v1/things", () => new HttpResponse(null, { status: 204 })));

    setCookie("facturador_csrf", "csrf-token-abc");
    const result = await apiFetch("/api/v1/things", { method: "POST", json: { x: 1 } });
    expect(result).toBeUndefined();
  });

  it("throws ApiError('schema.mismatch') when body fails validation", async () => {
    mswServer.use(
      http.get("/api/v1/things/42", () => HttpResponse.json({ id: "42", kind: "wrong" })),
    );

    await expect(apiFetch("/api/v1/things/42", { schema: OkSchema })).rejects.toMatchObject({
      name: "ApiError",
      code: "schema.mismatch",
      status: 200,
    });
  });
});

describe("apiFetch — CSRF cookie handling", () => {
  it("attaches X-CSRF-Token header on POST when cookie present", async () => {
    setCookie("facturador_csrf", "csrf-token-1");
    let received: string | null = null;
    mswServer.use(
      http.post("/api/v1/echo", ({ request }) => {
        received = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({ id: "1", kind: "ok" });
      }),
    );

    await apiFetch("/api/v1/echo", { method: "POST", json: { a: 1 }, schema: OkSchema });
    expect(received).toBe("csrf-token-1");
  });

  // Note: the prod-name fallback (`__Host-facturador_csrf`) is exercised by
  // `cookies.test.ts` with a direct call to `getCsrfTokenFromCookie`. We do
  // NOT exercise it here through `document.cookie` because jsdom rejects
  // cookies with the `__Host-` prefix on a non-Secure origin (the spec
  // requires `Secure`, which jsdom enforces by silently dropping the
  // assignment when the test page is `http://localhost`).

  it("does NOT attach X-CSRF-Token on GET even if cookie present", async () => {
    setCookie("facturador_csrf", "csrf-token-2");
    let received: string | null = "MISSING";
    mswServer.use(
      http.get("/api/v1/echo", ({ request }) => {
        received = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({ id: "1", kind: "ok" });
      }),
    );

    await apiFetch("/api/v1/echo", { schema: OkSchema });
    expect(received).toBeNull();
  });

  it("does NOT attach X-CSRF-Token when cookie absent but the request goes out", async () => {
    let received: string | null = "MISSING";
    mswServer.use(
      http.post("/api/v1/echo", ({ request }) => {
        received = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({ id: "1", kind: "ok" });
      }),
    );

    await apiFetch("/api/v1/echo", { method: "POST", schema: OkSchema });
    expect(received).toBeNull();
  });
});

describe("apiFetch — error handling", () => {
  it("parses ProblemDetail on 400 and preserves errors[]", async () => {
    mswServer.use(
      http.post("/api/v1/echo", () =>
        HttpResponse.json(
          {
            type: "urn:facturador:validation",
            title: "Datos inválidos",
            status: 400,
            code: "validation.failed",
            errors: [
              { identificador: "PASS01", mensaje: "Password too short", tipo: "ERROR" as const },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    let caught: unknown = null;
    try {
      await apiFetch("/api/v1/echo", { method: "POST", json: { a: 1 } });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    if (!(caught instanceof ApiError)) return;
    expect(caught.code).toBe("validation.failed");
    expect(caught.status).toBe(400);
    expect(caught.problem.errors).toHaveLength(1);
    expect(caught.problem.errors?.[0]?.identificador).toBe("PASS01");
  });

  it("dispatches auth:401 event and throws on 401", async () => {
    const spy = vi.fn();
    window.addEventListener(AUTH_EVENT_UNAUTHORIZED, spy);
    mswServer.use(
      http.get("/api/v1/me", () =>
        HttpResponse.json(
          { title: "Unauthenticated", status: 401, code: "auth.unauthorized" },
          { status: 401 },
        ),
      ),
    );

    await expect(apiFetch("/api/v1/me")).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EVENT_UNAUTHORIZED, spy);
  });

  it("dispatches auth:403 event on 403", async () => {
    const spy = vi.fn();
    window.addEventListener(AUTH_EVENT_FORBIDDEN, spy);
    mswServer.use(
      http.get("/api/v1/secret", () =>
        HttpResponse.json(
          { title: "Forbidden", status: 403, code: "auth.forbidden" },
          { status: 403 },
        ),
      ),
    );

    await expect(apiFetch("/api/v1/secret")).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EVENT_FORBIDDEN, spy);
  });

  it("synthesises a ProblemDetail when 500 returns non-JSON", async () => {
    mswServer.use(http.get("/api/v1/boom", () => new HttpResponse("oh no", { status: 500 })));

    let caught: unknown = null;
    try {
      await apiFetch("/api/v1/boom");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    if (!(caught instanceof ApiError)) return;
    expect(caught.code).toBe("http.unexpected");
    expect(caught.status).toBe(500);
  });

  it("wraps network failures in ApiError('network.unexpected')", async () => {
    mswServer.use(http.get("/api/v1/dead", () => HttpResponse.error()));

    let caught: unknown = null;
    try {
      await apiFetch("/api/v1/dead");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    if (!(caught instanceof ApiError)) return;
    expect(caught.code).toBe("network.unexpected");
  });
});

describe("apiFetch — path validation", () => {
  it("throws synchronously when path does not start with '/'", async () => {
    await expect(apiFetch("api/v1/me" as unknown as `/${string}`)).rejects.toThrow(
      /path must start with/,
    );
  });
});

describe("ApiError shape", () => {
  it("extends Error and carries problem + status + code", () => {
    const e = new ApiError({
      title: "Boom",
      status: 418,
      code: "test.boom",
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApiError");
    expect(e.message).toBe("Boom");
    expect(e.status).toBe(418);
    expect(e.code).toBe("test.boom");
    expect(e.problem.title).toBe("Boom");
  });
});
