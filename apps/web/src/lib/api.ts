/**
 * `apiFetch` — the ONE network primitive in `@facturador/web`.
 *
 * Source of truth:
 *   - SPEC-0040 §6.2 (HTTP client) + §6.3 (CSRF helper).
 *   - TASKS-0040 §2 (apiFetch + ApiError contract).
 *   - PLAN-0040 §4 Phase 2.
 *   - ai/context/security.md (no tokens in localStorage, ProblemDetail
 *     parsing, 401 / 403 global handling).
 *
 * Why a single primitive?
 *   - Forces every API call through one place that:
 *       * sends `credentials: "include"` (the session cookie is HttpOnly
 *         and only reaches the server because of this flag);
 *       * reads the CSRF cookie and echoes it as `X-CSRF-Token` on
 *         state-changing verbs;
 *       * parses ProblemDetail bodies into typed `ApiError` instances
 *         so call sites never see a raw HTTP error;
 *       * validates successful responses against the caller-supplied
 *         Zod schema so consumers receive parsed types, not `unknown`.
 *   - Tests grep the codebase (`src/`) for direct `fetch(` calls; this
 *     module is the ONLY allowed match. See `lib/api.no-fetch.test.ts`.
 *
 * 401 and 403 are dispatched as window-level events so:
 *   - `AuthProvider` can clear state on 401 and trigger a redirect to
 *     `/login?next=...`.
 *   - Route guards can show `/forbidden` on 403 without the route
 *     handler having to thread error state around.
 */
import { ProblemDetailSchema, type ProblemDetail } from "@facturador/contracts/errors";
import type { ZodTypeAny, z } from "zod";

import { env } from "../env.js";
import { getCsrfTokenFromCookie } from "./cookies.js";

/** HTTP verbs the CSRF guard requires us to attach a token for. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Subset of `RequestInit.method` we expose. Uppercase only. */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * `ApiFetchOptions` — caller-side knobs.
 *
 *   - `method` defaults to `GET`.
 *   - `json` is shorthand for an `application/json` body; we serialise it
 *     ourselves so callers don't accidentally double-encode.
 *   - `schema` is a Zod schema that the *successful* response body must
 *     parse against. If omitted, the response is returned as `unknown`
 *     — callers are then on their own (rare; only the `/auth/logout`
 *     204 path qualifies). Tests assert that nearly every consumer
 *     passes a schema.
 *   - `signal` for caller-controlled aborts.
 *   - `headers` for extra headers (e.g. `Idempotency-Key`). `Content-Type`
 *     is set automatically when `json` is present.
 */
export interface ApiFetchOptions<TSchema extends ZodTypeAny | undefined = undefined> {
  method?: ApiMethod;
  json?: unknown;
  /**
   * Optional Zod schema used to validate the successful response body.
   * The return type of `apiFetch` is inferred from the schema; if you
   * omit it the call returns `unknown`.
   */
  schema?: TSchema;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * `ApiError` — the only error type `apiFetch` throws.
 *
 * `problem` is the validated ProblemDetail body when the server returned
 * a parseable error envelope, otherwise a synthetic shape with `code`
 * `network.unexpected` (we still extend `Error` so existing try/catch
 * chains work).
 */
export class ApiError extends Error {
  public readonly problem: ProblemDetail;
  public readonly status: number;

  constructor(problem: ProblemDetail) {
    super(problem.title);
    this.name = "ApiError";
    this.problem = problem;
    this.status = problem.status;
  }

  /** Convenience access to the snake-case machine-readable error code. */
  get code(): string {
    return this.problem.code;
  }
}

/** Authoritative event names used to coordinate auth lifecycle with the SPA. */
export const AUTH_EVENT_UNAUTHORIZED = "auth:401";
export const AUTH_EVENT_FORBIDDEN = "auth:403";

/**
 * Resolve the full URL for a given API path. Leading `/` enforced so the
 * compose proxy can pick up `/api/*` requests in dev. When
 * `VITE_API_BASE_URL` is set (cross-origin dev / preview), prepend it.
 */
function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`[apiFetch] path must start with "/": received ${path}`);
  }
  return env.VITE_API_BASE_URL === "" ? path : `${env.VITE_API_BASE_URL}${path}`;
}

/** Best-effort safe JSON parse — returns `null` on any failure. */
async function readJsonOrNull(res: Response): Promise<unknown> {
  // 204 No Content / empty body — short-circuit. response.json() throws
  // on empty bodies in some runtimes.
  if (res.status === 204) return null;
  try {
    const text = await res.text();
    if (text === "") return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Build a fallback ProblemDetail when the server didn't speak the
 * envelope contract (e.g. nginx 502, browser DNS failure). We synthesise
 * just enough to throw a typed `ApiError`. The `code` is namespaced so
 * downstream UIs can match on it.
 */
function fallbackProblem(status: number, code: string, title: string): ProblemDetail {
  return {
    type: "about:blank",
    title,
    status,
    code,
  };
}

/**
 * Dispatch a window-level auth event. Wrapped in a function so tests can
 * spy on dispatching without coupling to `window.dispatchEvent`.
 */
function dispatchAuthEvent(eventName: string, status: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: { status } }));
}

/**
 * Core fetch helper. See module docstring for the full contract.
 *
 * Returns the schema-validated body. Throws `ApiError` on every non-2xx.
 * 401 and 403 ALWAYS dispatch their corresponding event *and* throw —
 * route handlers must still surface the error; the global listeners
 * handle navigation.
 */
export function apiFetch<TSchema extends ZodTypeAny>(
  path: string,
  options: ApiFetchOptions<TSchema> & { schema: TSchema },
): Promise<z.output<TSchema>>;
export function apiFetch(path: string, options?: ApiFetchOptions): Promise<unknown>;
export async function apiFetch<TSchema extends ZodTypeAny | undefined = undefined>(
  path: string,
  options: ApiFetchOptions<TSchema> = {},
): Promise<unknown> {
  const method: ApiMethod = options.method ?? "GET";
  const url = buildUrl(path);

  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  // CSRF — only on state-changing verbs. We deliberately do NOT throw if
  // the cookie is missing: tests assert the request goes out either way,
  // the server then rejects with 403 which becomes a typed ApiError.
  if (STATE_CHANGING_METHODS.has(method)) {
    const token = getCsrfTokenFromCookie();
    if (token !== null) headers.set("X-CSRF-Token", token);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "include",
      ...(body !== undefined ? { body } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // Network / DNS / CORS preflight failures. Surface as a typed ApiError
    // so consumers don't see a raw TypeError.
    throw new ApiError(
      fallbackProblem(
        0,
        "network.unexpected",
        cause instanceof Error ? cause.message : "Network request failed",
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Success path. Status 204 returns `undefined as TOut` so callers can
  // type the helper with `void` for no-body endpoints.
  // ---------------------------------------------------------------------
  if (response.ok) {
    if (response.status === 204) {
      return undefined;
    }
    const data = await readJsonOrNull(response);
    if (options.schema === undefined) {
      // Caller opted out of schema validation. Hand back the raw payload.
      return data;
    }
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(
        fallbackProblem(
          response.status,
          "schema.mismatch",
          "Response did not match expected schema",
        ),
      );
    }
    return parsed.data as unknown;
  }

  // ---------------------------------------------------------------------
  // Error path. Try ProblemDetail; if anything fails, fall back to a
  // synthetic envelope and still throw `ApiError`.
  // ---------------------------------------------------------------------
  const rawBody = await readJsonOrNull(response);
  const parsed = ProblemDetailSchema.safeParse(rawBody);
  const problem: ProblemDetail = parsed.success
    ? parsed.data
    : fallbackProblem(
        response.status,
        "http.unexpected",
        response.statusText !== "" ? response.statusText : "Unexpected error",
      );

  if (response.status === 401) {
    dispatchAuthEvent(AUTH_EVENT_UNAUTHORIZED, response.status);
  } else if (response.status === 403) {
    dispatchAuthEvent(AUTH_EVENT_FORBIDDEN, response.status);
  }

  throw new ApiError(problem);
}
