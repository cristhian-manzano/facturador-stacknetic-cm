---
id: TASKS-0006
spec: SPEC-0006
plan: PLAN-0006
title: Error model & logging — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0006 — Error model & logging

> Checklist for [SPEC-0006](../specs/0006-error-model-and-logging.md) + [PLAN-0006](../plans/0006-error-model-and-logging-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `console.log` in source code (lint enforces).
- ❌ No raw `process.env` access outside `src/env.ts` (lint enforces).
- ❌ Never reduce the REDACT_PATHS list. New sensitive fields are added, never removed.
- ✅ Every `AppError` subclass has a default `status` and `code`.
- ✅ The error middleware MUST be the **last** middleware registered.
- ✅ The redaction test must observe `[REDACTED]` for every sensitive key.

## 1. `@facturador/utils/errors`

- [ ] **1.1** Create `packages/utils/src/errors/app-error.ts`: abstract `class AppError extends Error` with `status`, `code`, `detail?`, `errors?` typed via `SriMensaje[]` from contracts.
      **Validate**: unit test asserts `new SomeError().status` and `code` propagate.

- [ ] **1.2** Subclasses (in same dir, separate files):

  - `ValidationError` (400, `validation_failed`).
  - `AuthError` (401, `unauthenticated`).
  - `ForbiddenError` (403, `forbidden`).
  - `NotFoundError` (404, `not_found`).
  - `ConflictError` (409, `conflict`).
  - `RateLimitError` (429, `rate_limited`).
  - `UpstreamError` (502, `upstream_failure`).
  - `BusinessError` (422, `business_rule_violation`).
    **Validate**: a parametrised test asserts each `(status, code)` pair.

- [ ] **1.3** Helper `toProblemDetail(err: unknown, requestId?: string)` returning a `ProblemDetail`-shaped object validated by `ProblemDetailSchema` from contracts.
      **Validate**: unit tests for each error type → shape parses with `ProblemDetailSchema`.

- [ ] **1.4** Re-export errors from `packages/utils/src/index.ts` (or via subpath `@facturador/utils/errors`).
      **Validate**: a consumer file imports `AuthError` and creates an instance without TS errors.

## 2. `@facturador/logger`

- [ ] **2.1** Add deps to `packages/logger/package.json`: `pino@^9`, `pino-pretty@^11` (dev or runtime — runtime is fine; transport is gated by NODE_ENV).
      **Validate**: `pnpm install` exits 0.

- [ ] **2.2** `packages/logger/src/redactions.ts`: export `REDACT_PATHS` (typed `string[]`) including every entry from PLAN §4 Phase 2.
      **Validate**: `Array.isArray(REDACT_PATHS) && REDACT_PATHS.length >= 12`.

- [ ] **2.3** `packages/logger/src/index.ts`:

  - `createLogger({ service }: { service: string })` returns a Pino instance with:
    - `level` from `LOG_LEVEL` env (read via the package's own `env.ts` Zod schema, default `info`).
    - `redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }`.
    - `base: { service, pid: process.pid, hostname: os.hostname() }`.
    - `transport` only when `NODE_ENV !== "production"`.
  - `withRequest(logger, req)` returns `logger.child({ requestId: req.id })`.
    **Validate**: unit test creates a logger, calls `info({ signedXml: "<xml/>", password: "p", nested: { passwordHash: "h", ok: 1 } }, "x")` and asserts via a captured stream that the JSON line has each sensitive field replaced with `[REDACTED]` and `ok: 1` intact.

- [ ] **2.4** Export everything via `packages/logger/src/index.ts` + add subpath exports if needed.
      **Validate**: typecheck clean.

## 3. Middleware (api + sri-core)

- [ ] **3.1** `apps/api/src/middleware/request-id.ts`:

  ```ts
  import { ulid } from "ulid";
  export const requestIdMiddleware = (req, res, next) => {
    const id = (req.headers["x-request-id"] as string) || ulid();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
  ```

  **Validate**: unit test (Supertest) asserts a generated `X-Request-Id` header on every response; another asserts header echo when client provides one.

- [ ] **3.2** `apps/api/src/middleware/error-handler.ts`:

  ```ts
  export const errorHandler = (err, req, res, _next) => {
    const problem = toProblemDetail(err, req.id);
    req.log?.error({ err, problem }, "request_error");
    res.status(problem.status).json(problem);
  };
  ```

  **Validate**: Supertest hits a route that throws `AuthError` → response 401 + JSON body parsing through `ProblemDetailSchema` succeeds.

- [ ] **3.3** `apps/api/src/middleware/validate.ts`:

  - `validateBody(schema)` runs `schema.safeParse(req.body)`. On failure: throw `ValidationError` with `errors` built from `result.error.issues` mapped to `SriMensaje`-shaped objects (`identificador` from `issue.path.join(".")`, `mensaje` from `issue.message`, `tipo: "ERROR"`).
  - Same for `validateQuery`, `validateParams`.
    **Validate**: a test route registers `validateBody(LoginRequestSchema)`; bad body → 400 + ProblemDetail; good body → 200.

- [ ] **3.4** Replicate the three middlewares in `apps/sri-core/src/middleware/` (DRY via a tiny shared util OK; copy is acceptable for now since both apps run independently).
      **Validate**: identical Supertest tests pass against sri-core.

## 4. Audit helper

- [ ] **4.1** `packages/utils/src/audit.ts`: accepts a `Prisma`-injected client; signature:
  ```ts
  export async function audit(
    prisma,
    payload: { action; entity; entityId?; companyId?; actorUserId?; ip?; userAgent?; payloadJson? },
  ): Promise<void>;
  ```
  - Writes a row; catches errors and logs them (does NOT throw to the caller).
  - Sanitises `payloadJson` by passing through a redactor (reuse logger's redact paths via a small JSON walker, or accept caller's responsibility — document the choice).
    **Validate**: integration test: call `audit(...)` inside a Vitest with a real Prisma + Postgres test schema; assert the row exists with expected fields.

## 5. Wiring into Express apps

- [ ] **5.1** `apps/api/src/server.ts`: middleware order:

  ```
  requestIdMiddleware
  → logger child attach (req.log = withRequest(rootLogger, req))
  → cors + json parser
  → routes
  → errorHandler (LAST)
  ```

  **Validate**: a `/health` test still returns 200; a `/forced-error` test route throws `BusinessError` and returns 422.

- [ ] **5.2** Same wiring in `apps/sri-core/src/server.ts`.
      **Validate**: same forced-error test passes.

## 6. End-to-end Supertest assertions

- [ ] **6.1** Hit `POST /api/v1/echo` with `{ email: "x" }` (Zod validation route). Expect 400; body validates against `ProblemDetailSchema`; `errors` length ≥ 1.
      **Validate**: test green.

- [ ] **6.2** Hit `/forced-error?type=auth` → 401, `code: "unauthenticated"`.
      Hit `/forced-error?type=forbidden` → 403, `code: "forbidden"`.
      Hit `/forced-error?type=conflict` → 409, `code: "conflict"`.
      Hit `/forced-error?type=upstream` → 502, `code: "upstream_failure"`.
      **Validate**: all four return expected status + code.

## 7. Acceptance criteria

- [ ] AC-1: Uniform `ProblemDetail` returned on every error path.
- [ ] AC-2: REDACT_PATHS masks each listed key in log output.
- [ ] AC-3: `audit()` writes a durable row and never throws.
- [ ] AC-4: `validateBody` returns 400 with `ProblemDetail.errors` populated.
- [ ] AC-5: Each request carries `X-Request-Id`.
- [ ] AC-6: No `console.log` in source.
- [ ] AC-7: Redaction list documented in `redactions.ts` and reviewable in code review.

## 8. Definition of Done

- All boxes ticked.
- All redaction tests assert `[REDACTED]` for each sensitive key.
- All forced-error routes return the expected status + ProblemDetail code.
- Review file `ai/reviews/0006-error-model-and-logging-review.md` written.
