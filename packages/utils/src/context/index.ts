/**
 * `@facturador/utils/context` — per-request `AsyncLocalStorage` plumbing.
 *
 * Why this lives in `utils` (and NOT `contracts`):
 *
 *   - `AsyncLocalStorage` is a Node-runtime API; `contracts` is intentionally
 *     a pure Zod / TS package with no Node deps so it stays importable from
 *     edge / web bundles. Anything that touches `node:*` belongs here.
 *
 * Why this exists at all (SPEC-0006 §6.4 + REVIEW-0006 §10 #4):
 *
 *   - Express middleware sets a request-scoped `RequestContext` exactly once
 *     per incoming HTTP request (see `apps/api/src/middleware/request-id.ts`).
 *   - Anything downstream that needs `requestId`, `companyId`, `userId`, or
 *     the originating `serviceCaller` (used by `audit()`, the SRI client,
 *     and the orchestrator) can read it from `getContext()` instead of
 *     threading it through every signature.
 *   - `runWithContext` MUST wrap the request lifecycle so async hops
 *     (`await`, timers, microtasks) preserve the binding.
 *
 * Contract guarantees the rest of the codebase depends on:
 *
 *   1. Nested `runWithContext` calls SHADOW the outer ctx for the inner
 *      scope only — popping back to the outer ctx is implicit (handled by
 *      `AsyncLocalStorage` itself). This is the standard behaviour but is
 *      pinned by `context.test.ts`.
 *   2. Async continuations (Promises, `setImmediate`, `setTimeout`) keep
 *      the binding without explicit propagation.
 *   3. Outside any `runWithContext` scope, `getContext()` returns
 *      `undefined` (NOT a stub object); `requireContext()` throws.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context. Kept intentionally small: only the IDs that EVERY
 * downstream module needs. Adding a field is a real schema change — audit
 * payloads, log lines, and the SRI client all consume this surface, so a
 * new field must be threaded through their tests too.
 *
 * Why `serviceCaller` is a string union (not a free-form string):
 *
 *   - `audit()` uses it to tag `actor.type` on the audit row.
 *   - The SRI client uses it to short-circuit cross-service loops.
 *   - Locking the values down forces every new caller to opt in at the
 *     type level.
 */
export interface RequestContext {
  /** ULID for the request. Used as the audit row `id` correlation key. */
  readonly requestId: string;
  /** Tenant scope. Absent on auth/health/anonymous routes. */
  readonly companyId?: string;
  /** Authenticated user. Absent on anonymous routes. */
  readonly userId?: string;
  /**
   * Which service originated this call. `api` = browser → apps/api,
   * `sri-core` = apps/sri-core background job, `web` = SSR/SPA-side
   * helper (rare, reserved for future SSR work).
   */
  readonly serviceCaller?: "api" | "sri-core" | "web";
}

// Module-scoped instance: there is EXACTLY ONE store per process. Creating
// a fresh `AsyncLocalStorage` in a function would defeat the purpose
// (each request would have its own isolated map). Tests import this same
// barrel so they share the singleton.
const als = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with `ctx` bound for the duration of the call AND every async
 * continuation chained from inside it. Returns whatever `fn` returns.
 *
 * Sync example:
 *   ```ts
 *   const out = runWithContext({ requestId: "01H..." }, () => doWork());
 *   ```
 *
 * Async example (the binding survives `await`):
 *   ```ts
 *   await runWithContext({ requestId }, async () => {
 *     await prisma.user.findUnique({ ... }); // getContext() === { requestId }
 *   });
 *   ```
 *
 * Why a thin wrapper instead of exporting `als` directly:
 *
 *   - Hides the `AsyncLocalStorage` instance (callers can't accidentally
 *     `als.disable()` or `als.enterWith()` and corrupt the store).
 *   - Lets the test suite spy on entries/exits if we ever need to.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/**
 * Look up the current context. Returns `undefined` when called OUTSIDE
 * any `runWithContext` scope — callers MUST handle that branch (typical
 * use is `getContext()?.requestId ?? "unknown"`).
 *
 * Why `undefined` instead of throwing:
 *
 *   - The audit helper and logger both call this on every line. Throwing
 *     on the (legitimate) "no request scope" path (cron startup, test
 *     bootstrap) would make every call site wrap in try/catch.
 */
export function getContext(): RequestContext | undefined {
  return als.getStore();
}

/**
 * Like `getContext` but throws when there's no active scope. Use this from
 * code that CANNOT meaningfully run without a request context (e.g. the
 * SRI client `requireServiceJwt()` path or anything that has to attribute
 * a write to a user).
 *
 * The error message is intentionally generic — leaking the call-site
 * function name would let a probe map the codebase.
 */
export function requireContext(): RequestContext {
  const c = als.getStore();
  if (c === undefined) {
    throw new Error("RequestContext is required but missing.");
  }
  return c;
}
