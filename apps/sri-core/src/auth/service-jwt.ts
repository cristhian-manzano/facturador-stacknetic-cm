/**
 * `requireServiceJwt` middleware — verifies the HS256 service token minted
 * by apps/api on every inbound request to /v1/* routes.
 *
 * Source of truth:
 *   - SPEC-0020 §6.3 + §6.5 (middleware chain).
 *   - TASKS-0020 §3.1 (rejection matrix).
 *   - PROMPT-0020 §6 (security policy).
 *
 * Behaviour:
 *   1. Read `Authorization: Bearer <jwt>`.
 *   2. Delegate verification to @facturador/utils/service-jwt with the
 *      shared secret loaded by env.ts. HS256 only, aud=sri-core, iss=api,
 *      exp + 5 s clock tolerance.
 *   3. Replay defence: once a `jti` is consumed it lands in a TTL-bounded
 *      in-memory deny-list (sized at `2 × max-tokens-in-flight` via
 *      `lru-cache`). A second arrival with the same `jti` while still
 *      inside the window is rejected with `auth.replay`.
 *   4. On success: attach `req.service = { companyId, jti? }` so handlers
 *      can scope every query.
 *   5. On failure: throw a single `AuthError("sri.service_token_invalid")`
 *      with status 401 (or `auth.replay` for the replay branch). We
 *      deliberately do NOT branch the error message on the reason
 *      (alg / aud / sig / expired all return the same 401) so the wire
 *      surface doesn't leak why exactly the token was rejected. The
 *      structured reason is logged server-side via `req.log`.
 *
 * Production note: this LRU lives in-process and resets on a redeploy.
 * Once SPEC-0050 lands the deny-list should move to Redis so multi-replica
 * deployments share state; SPEC-0050 §replay-defence is the home for it.
 */
import type { RequestHandler } from "express";
import { LRUCache } from "lru-cache";

import { AuthError } from "@facturador/utils/errors";
import { verifyServiceJwt, type VerifyFailureReason } from "@facturador/utils/service-jwt";

export interface BuildRequireServiceJwtDeps {
  /** Shared HS256 secret; injected by `createApp` so tests can override. */
  readonly secret: string;
  /**
   * Override the deny-list. Tests inject a deterministic cache so they
   * can observe TTL eviction and reject-on-replay semantics without
   * waiting on a real clock. Production keeps the module-default below.
   */
  readonly jtiDenyList?: JtiDenyList;
  /**
   * Override the clock. Tests inject `() => fixedMs` to step the LRU's
   * TTL forwards deterministically. Production uses `Date.now`.
   */
  readonly nowMs?: () => number;
}

const SERVICE_TOKEN_ERROR_CODE = "sri.service_token_invalid";
const REPLAY_ERROR_CODE = "auth.replay";

/**
 * Hard cap from SPEC-0020 §6.3 — tokens live ≤ 60 s, so an entry never
 * needs to sit longer than that even if the body clock leaked a much
 * larger `exp`.
 */
const JTI_MAX_TTL_MS = 60_000;

/**
 * In-memory `jti` deny-list. The shape is a thin wrapper around
 * `lru-cache` so tests can pass their own implementation without pulling
 * the LRU semantics into the contract.
 */
export interface JtiDenyList {
  has(jti: string): boolean;
  /** Insert with the provided TTL (ms). The store clamps to its own ceiling. */
  set(jti: string, ttlMs: number): void;
}

/**
 * Default in-memory deny-list backed by `lru-cache`. Sized at 4096 entries
 * which comfortably covers the steady-state token-mint rate (60 s window
 * × tokens minted per second) without growing the resident set.
 *
 * Exported for tests + ops introspection; production callers reach the
 * shared singleton via `getDefaultJtiDenyList`.
 */
export function createJtiDenyList(): JtiDenyList {
  const cache = new LRUCache<string, true>({
    max: 4096,
    ttl: JTI_MAX_TTL_MS,
    // `ttlResolution: 0` evaluates staleness on every `get()` so a
    // tightly-controlled test clock observes eviction immediately.
    ttlResolution: 0,
  });
  return {
    has: (jti) => cache.has(jti),
    set: (jti, ttlMs) => {
      // Clamp the TTL to the hard ceiling — never trust the JWT body's
      // claimed lifetime past SPEC-0020 §6.3.
      const clamped = Math.max(1, Math.min(ttlMs, JTI_MAX_TTL_MS));
      cache.set(jti, true, { ttl: clamped });
    },
  };
}

// Module-private default. Lazily constructed so unit tests that import
// this module without ever calling the middleware don't pay for the
// allocation.
let defaultJtiDenyList: JtiDenyList | undefined;

/** Return the process-wide default deny-list, creating it on first call. */
export function getDefaultJtiDenyList(): JtiDenyList {
  defaultJtiDenyList ??= createJtiDenyList();
  return defaultJtiDenyList;
}

/** Test seam — clear the module-default so a fresh suite starts clean. */
export function _resetDefaultJtiDenyListForTests(): void {
  defaultJtiDenyList = undefined;
}

function readBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  if (!header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length === 0 ? undefined : token;
}

export function buildRequireServiceJwt(deps: BuildRequireServiceJwtDeps): RequestHandler {
  const denyList = deps.jtiDenyList ?? getDefaultJtiDenyList();
  const nowMs = deps.nowMs ?? Date.now;
  return async function requireServiceJwt(req, _res, next) {
    try {
      const token = readBearer(req.header("authorization"));
      if (token === undefined) {
        req.log?.warn(
          { event: "service_jwt.reject", reason: "missing_token" },
          "service token missing",
        );
        throw new AuthError("Service token required", SERVICE_TOKEN_ERROR_CODE);
      }
      const result = await verifyServiceJwt({ token, secret: deps.secret });
      if (!result.ok) {
        req.log?.warn(
          { event: "service_jwt.reject", reason: result.reason satisfies VerifyFailureReason },
          "service token rejected",
        );
        throw new AuthError("Invalid service token", SERVICE_TOKEN_ERROR_CODE);
      }
      // Replay defence: a `jti` that's already in the deny-list inside
      // its TTL window is treated as a replay. Tokens without `jti` skip
      // the check (they're not minted by api in any release, but we must
      // not crash on third-party tokens that happen to satisfy the claim
      // matrix without one).
      if (result.claims.jti !== undefined) {
        if (denyList.has(result.claims.jti)) {
          req.log?.warn(
            {
              event: "service_jwt.reject",
              reason: "replay",
              jti: result.claims.jti,
            },
            "service token replay detected",
          );
          throw new AuthError("Service token replayed", REPLAY_ERROR_CODE);
        }
        // Burn the jti for the remainder of the token's lifetime. The
        // store clamps to a 60 s ceiling so a long-lived `exp` cannot
        // pin the entry.
        const remainingMs = Math.max(0, result.claims.exp * 1000 - nowMs());
        denyList.set(result.claims.jti, remainingMs);
      }
      // Stamp on the request for downstream handlers. We choose a tiny shape
      // (`companyId` + optional `jti`) on purpose — no PII, no claims dump.
      req.service = {
        companyId: result.claims.sub,
        ...(result.claims.jti === undefined ? {} : { jti: result.claims.jti }),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Re-export the constant so call sites referencing the error code don't have
// to import a stringly-typed magic value.
export const SERVICE_JWT_ERROR_CODE = SERVICE_TOKEN_ERROR_CODE;
export const SERVICE_JWT_REPLAY_ERROR_CODE = REPLAY_ERROR_CODE;
