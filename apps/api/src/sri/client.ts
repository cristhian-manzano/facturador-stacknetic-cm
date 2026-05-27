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
import type { ZodTypeAny } from "zod";

import { UpstreamError } from "@facturador/utils/errors";
import {
  mintServiceJwt as mintServiceJwtPrimitive,
  SERVICE_JWT_AUDIENCE,
  SERVICE_JWT_ISSUER,
} from "@facturador/utils/service-jwt";

import { env } from "../env.js";

/**
 * Retry budget for transient upstream 5xx (502 / 503 / 504). Wait
 * times in milliseconds — three attempts after the initial request.
 * 4xx responses MUST NOT be retried (they're contract violations,
 * not transient).
 */
const RETRY_BACKOFF_MS: readonly number[] = [100, 250, 500];
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  /**
   * Optional Zod schema applied to the parsed JSON body. When provided
   * the helper calls `schema.parse(json)` and throws `UpstreamError` on
   * mismatch — this replaces the legacy `as T` cast at every call site.
   * Existing callers that pass no schema keep the previous behaviour.
   */
  readonly schema?: ZodTypeAny;
  /**
   * Optional override of the retry backoff vector for transient 5xx
   * responses (502 / 503 / 504). Default `[100, 250, 500]` ms. Set to
   * `[]` to disable retries entirely (used by some tests).
   */
  readonly retryBackoffMs?: readonly number[];
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

  // Retry loop on transient 5xx (502/503/504). 4xx is a terminal
  // contract violation — never retried. Connection failures count as
  // transient and exhaust the budget exactly like a 503 would.
  const backoff: readonly number[] = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const maxAttempts = backoff.length + 1;
  let response: Response | null = null;
  let lastTransientCause: unknown = undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      // Network-level failure: surface as transient. Retry until budget
      // is exhausted, then throw UpstreamError.
      lastTransientCause = cause;
      response = null;
      if (attempt < backoff.length) {
        const ms = backoff[attempt];
        if (ms !== undefined) await sleep(ms);
        continue;
      }
      throw new UpstreamError("sri-core network failure", "sri.network", {
        cause,
      });
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < backoff.length) {
      // Drain the body so the connection can be reused and back off.
      try {
        await response.text();
      } catch {
        /* ignore drain errors */
      }
      lastTransientCause = { status: response.status };
      const ms = backoff[attempt];
      if (ms !== undefined) await sleep(ms);
      continue;
    }
    // Either a 2xx, a 3xx, a non-retryable 4xx, or budget exhausted on
    // a transient 5xx — fall through to the body-parse stage.
    break;
  }
  if (response === null) {
    throw new UpstreamError("sri-core network failure", "sri.network", {
      cause: lastTransientCause,
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

  // Optional Zod parse: replaces the legacy `as T` cast at every call
  // site. Schema mismatch surfaces as a 502 UpstreamError so the caller
  // doesn't have to distinguish between "sri-core returned a 5xx" and
  // "sri-core returned a 2xx with a bogus body" — both are upstream
  // contract violations from the api's perspective.
  if (options.schema !== undefined) {
    const result = options.schema.safeParse(parsed);
    if (!result.success) {
      throw new UpstreamError(
        "sri-core response failed schema validation",
        "sri.contract",
        { cause: result.error },
      );
    }
    return {
      status: response.status,
      body: result.data as T,
    };
  }

  return { status: response.status, body: parsed as T };
}

// Re-export the contract for callers that want to assert claim invariants.
export const SRI_CORE_JWT_ISSUER = SERVICE_JWT_ISSUER;
export const SRI_CORE_JWT_AUDIENCE = SERVICE_JWT_AUDIENCE;
