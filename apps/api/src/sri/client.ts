/**
 * `apps/api` ⇒ `apps/sri-core` client.
 *
 * Source of truth: SPEC-0020 §6.3 + PLAN-0020 §3 + TASKS-0020 §3.2.
 *
 *   - `mintServiceJwt({ companyId })` — produces a fresh HS256 JWT with
 *     `aud=sri-core`, `iss=api`, `sub=<companyId>`, `exp=now+60s`.
 *     Delegates to `@facturador/utils/service-jwt`.
 *
 *   - `sriCoreFetch(path, init)` — thin wrapper around the global `fetch`
 *     that:
 *       1. Mints a fresh JWT for the call's `companyId`.
 *       2. Attaches `Authorization: Bearer <jwt>`.
 *       3. Forwards `X-Request-Id` so log correlation flows end-to-end.
 *       4. Throws `UpstreamError("sri.network")` on non-2xx and surfaces
 *          the body's `ProblemDetail.code` (when present) as `detail`.
 *
 * Note: this slice never logs the JWT, never logs the request body, and
 * never logs the response body — REDACT_PATHS already covers each of these.
 */
import {
  mintServiceJwt as mintServiceJwtPrimitive,
  SERVICE_JWT_AUDIENCE,
  SERVICE_JWT_ISSUER,
} from "@facturador/utils/service-jwt";
import { UpstreamError } from "@facturador/utils/errors";
import { env } from "../env.js";

export interface MintServiceJwtArgs {
  readonly companyId: string;
  /** Override the secret for tests; defaults to env.SERVICE_JWT_SECRET. */
  readonly secret?: string;
  /** Override TTL (≤ 60 s, validated by the helper). */
  readonly ttlSeconds?: number;
}

export async function mintServiceJwt(args: MintServiceJwtArgs): Promise<string> {
  return await mintServiceJwtPrimitive({
    companyId: args.companyId,
    secret: args.secret ?? env.SERVICE_JWT_SECRET,
    ...(args.ttlSeconds === undefined ? {} : { ttlSeconds: args.ttlSeconds }),
  });
}

export interface SriCoreFetchOptions {
  /** Tenant whose request this is — embedded as the JWT `sub`. */
  readonly companyId: string;
  /** Optional correlation id forwarded as `X-Request-Id`. */
  readonly requestId?: string;
  /** HTTP method, defaults to GET. */
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request body — JSON-stringified for the caller. */
  readonly body?: unknown;
  /**
   * Override the base URL. Defaults to `env.SRI_CORE_URL`. Tests using
   * Supertest pass the in-process Supertest agent's URL.
   */
  readonly baseUrl?: string;
  /** Override the JWT secret + TTL for tests. */
  readonly serviceJwtSecret?: string;
  readonly serviceJwtTtlSeconds?: number;
  /** Inject a fetch implementation for tests. Defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface SriCoreFetchResult<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * POST/GET wrapper for sri-core calls. Returns the parsed JSON body on
 * 2xx; throws `UpstreamError("sri.network")` on connectivity / non-2xx.
 */
export async function sriCoreFetch<T>(
  path: string,
  options: SriCoreFetchOptions,
): Promise<SriCoreFetchResult<T>> {
  const baseUrl = options.baseUrl ?? env.SRI_CORE_URL;
  const url = new URL(path, baseUrl).toString();
  const fetchImpl = options.fetchImpl ?? fetch;

  const token = await mintServiceJwt({
    companyId: options.companyId,
    ...(options.serviceJwtSecret === undefined ? {} : { secret: options.serviceJwtSecret }),
    ...(options.serviceJwtTtlSeconds === undefined
      ? {}
      : { ttlSeconds: options.serviceJwtTtlSeconds }),
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.requestId !== undefined) {
    headers["X-Request-Id"] = options.requestId;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (cause) {
    throw new UpstreamError("sri-core network failure", "sri.network", {
      cause,
    });
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body from sri-core is itself a contract violation; map it
      // to the same upstream error.
      throw new UpstreamError("sri-core returned a non-JSON body", "sri.network");
    }
  }

  if (response.status < 200 || response.status >= 300) {
    const code = (parsed as { code?: string } | undefined)?.code ?? "sri.network";
    throw new UpstreamError(`sri-core responded ${String(response.status)}`, code, {
      // `detail` is user-safe (never includes the body); the
      // ProblemDetail comes through as `cause` for server-side
      // observability only.
      cause: parsed,
    });
  }

  return { status: response.status, body: parsed as T };
}

// Re-export the contract for callers that want to assert claim invariants.
export const SRI_CORE_JWT_ISSUER = SERVICE_JWT_ISSUER;
export const SRI_CORE_JWT_AUDIENCE = SERVICE_JWT_AUDIENCE;
