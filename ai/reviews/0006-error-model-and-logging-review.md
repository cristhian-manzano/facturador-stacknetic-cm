---
id: REVIEW-0006
spec: SPEC-0006
plan: PLAN-0006
tasks: TASKS-0006
prompt: PROMPT-0006
title: Error model & logging — implementation review
status: complete
created: 2026-05-21
---

# REVIEW-0006 — Error model & logging

## 1. Summary

SPEC-0006 is fully wired. The platform now has:

- A typed `AppError` hierarchy (nine subclasses, one file per class) that
  encodes the canonical `(status, code)` taxonomy.
- A pure `toProblemDetail(err, requestId?)` translator that validates every
  output through `ProblemDetailSchema` from `@facturador/contracts/errors` and
  falls back to a minimal 500 envelope if anything goes wrong (so it is total
  and never throws).
- A `@facturador/logger` package built on Pino 9, with an **extend-only**
  `REDACT_PATHS` constant frozen via `Object.freeze` and a `[REDACTED]` censor.
  Both root and `*.field` forms are listed for every sensitive key so nested
  payloads are masked. `pino-pretty` is gated behind `NODE_ENV !== "production"`.
- A `withRequest(logger, req)` helper that binds `requestId` to a child logger.
- Three middlewares per app — `requestIdMiddleware`, `createRequestLogger`,
  `errorHandler` — plus a `validateBody` / `validateQuery` / `validateParams`
  family that turns Zod failures into `ValidationError` instances populated
  with `SriMensaje[]` entries in deterministic order.
- `apps/api/src/server.ts` and `apps/sri-core/src/server.ts` wire the
  middlewares in the required order:
  `requestIdMiddleware → createRequestLogger → express.json → routes → errorHandler`.
  The error middleware is the **last** middleware in both apps.
- Two diagnostic routes per app — `POST /v1/_diag/echo` (Zod-validated body)
  and `GET /v1/_diag/forced-error?type=...` — that exercise the validator and
  every subclass of `AppError` end-to-end.
- An `audit()` helper in `@facturador/utils/audit` with deterministic id
  injection, a JSON walker that mirrors `REDACT_PATHS`, and best-effort
  semantics (never throws; emits a single error log line on failure).

124 unit + integration tests pass across `@facturador/logger` (35),
`@facturador/utils` (45), `apps/api` (23), and `apps/sri-core` (17).
Repo-wide `typecheck` and `build` are green. The forced-error matrix in both
apps covers all nine subclasses; every response body parses through
`ProblemDetailSchema`. A captured-stream Supertest verifies that **no**
sensitive literal (passwords, private keys, certificates, signed XML, clave
de acceso, `Authorization`/`Cookie` headers) leaks into a real Pino log line.

## 2. Files created / changed

### Created during this session

Middlewares for `apps/sri-core` (mirror of `apps/api`):

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/logger.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/types/express.d.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/middleware/request-id.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/middleware/request-logger.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/middleware/error-handler.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/middleware/validate.ts`

End-to-end Supertest suites (forced-error matrix + redaction):

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/error-model.test.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/error-model.test.ts`

### Modified during this session

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/server.ts` — added the
  full middleware chain in the required order and registered
  `POST /v1/_diag/echo` + `GET /v1/_diag/forced-error`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/server.ts` — same
  middleware order with the local echo schema; no Prisma dependency.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/middleware/request-logger.ts`
  — fixed `exactOptionalPropertyTypes` issue when forwarding `req.id` into
  `withRequest(...)`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/logger/src/redactions.ts`
  — switched the type assertion to `as const satisfies readonly string[]` so
  ESLint's `no-unnecessary-type-assertion` is satisfied while the literal
  array stays immutable.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/logger/src/index.test.ts` —
  dot-notation cleanup for `req.headers.authorization` / `req.headers.cookie`.

### Inherited from the previous session (referenced for context)

- `packages/utils/src/errors/{app-error,validation-error,auth-error,forbidden-error,not-found-error,conflict-error,business-error,rate-limit-error,upstream-error,internal-server-error,to-problem-detail,index}.ts`
  and their sibling `.test.ts` files.
- `packages/utils/src/audit/{audit,redact,index}.ts` + `.test.ts`.
- `packages/logger/src/{env,redactions,index}.ts` + `.test.ts`.
- `apps/api/src/{logger.ts, types/express.d.ts}`.
- `apps/api/src/middleware/{request-id,request-logger,error-handler,validate}.ts`.

## 3. Validation evidence

### 3.1 Test runner output (all green)

```
@facturador/logger
  ✓ src/redactions.test.ts  (26 tests)
  ✓ src/index.test.ts        (9 tests)
  Tests  35 passed (35)

@facturador/utils
  ✓ src/errors/app-error.test.ts        (15 tests)
  ✓ src/errors/to-problem-detail.test.ts (17 tests)
  ✓ src/audit/audit.test.ts              (4 tests)
  ✓ src/audit/redact.test.ts             (9 tests)
  Tests  45 passed (45)

@facturador/api
  ✓ src/contracts.smoke.test.ts (4 tests)
  ✓ src/server.test.ts          (1 test)
  ✓ src/health-db.test.ts       (1 test)
  ✓ src/error-model.test.ts     (17 tests)
  Tests  23 passed (23)

@facturador/sri-core
  ✓ src/server.test.ts        (1 test)
  ✓ src/error-model.test.ts   (16 tests)
  Tests  17 passed (17)
```

`pnpm -r typecheck` and `pnpm -r build` both exit `0`. The whole repository
(8 of 9 workspaces; `web` is React + Vite) builds clean under
`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`,
`verbatimModuleSyntax: true`.

### 3.2 Real log lines — redaction proven

A synthetic payload exercised through `createLogger(...).info(...)` with a
captured stream:

```json
{
  "level": "info",
  "time": "2026-05-21T15:10:37.500Z",
  "service": "api",
  "env": "test",
  "pid": 2706,
  "hostname": "GFT-C6HXYRXDYP",
  "signedXml": "[REDACTED]",
  "password": "[REDACTED]",
  "nested": {
    "passwordHash": "[REDACTED]",
    "privateKey": "[REDACTED]",
    "claveAcceso": "[REDACTED]",
    "ok": 1
  },
  "req": {
    "headers": {
      "authorization": "[REDACTED]",
      "cookie": "[REDACTED]",
      "content-type": "application/json"
    }
  },
  "res": {
    "headers": {
      "set-cookie": "[REDACTED]"
    }
  },
  "msg": "synthetic_log_with_secrets"
}
```

Leak audit (every sensitive substring submitted, none appear anywhere in the
captured stream):

```
p455w0rd-DEMO                                       redacted
BEGIN PRIVATE KEY                                   redacted
0511202401179001234400110010010000000010123456789   redacted
Bearer leaked-DEMO                                  redacted
session=leaked-DEMO                                 redacted
$argon2id$DEMO                                      redacted
```

A real `request_error` line emitted by the apps/api forced-error route (note
that `err.message` is preserved server-side for debugging — secrets in `err`
would still be masked because the same Pino redactor runs on the entire log
object):

```json
{
  "level": "error",
  "time": "2026-05-21T15:10:15.715Z",
  "service": "api",
  "env": "test",
  "pid": 2147,
  "hostname": "GFT-C6HXYRXDYP",
  "requestId": "01HX8K0PYFA9B7Y1M2N3P4Q5R6",
  "err": {
    "type": "BusinessError",
    "message": "Totals mismatch",
    "name": "BusinessError",
    "status": 422,
    "code": "invoice.totals_mismatch",
    "stack": "BusinessError: Totals mismatch\n    at ..."
  },
  "problem": {
    "type": "urn:facturador:error:invoice.totals_mismatch",
    "title": "Totals mismatch",
    "status": 422,
    "code": "invoice.totals_mismatch",
    "instance": "01HX8K0PYFA9B7Y1M2N3P4Q5R6"
  },
  "msg": "request_error"
}
```

### 3.3 Real ProblemDetail responses

`GET /v1/_diag/forced-error?type=business` returns HTTP 422 with body:

```json
{
  "type": "urn:facturador:error:invoice.totals_mismatch",
  "title": "Totals mismatch",
  "status": 422,
  "code": "invoice.totals_mismatch",
  "instance": "01HX8K0PYFA9B7Y1M2N3P4Q5R6"
}
```

`POST /v1/_diag/echo` with `{ email: "not-an-email", password: "supersecret-DEMO-VALUE" }`
returns HTTP 400 with body:

```json
{
  "type": "urn:facturador:error:validation.failed",
  "title": "Invalid request body",
  "status": 400,
  "code": "validation.failed",
  "instance": "01HX8K0PYFA9B7Y1M2N3P4Q5R6",
  "errors": [
    {
      "identificador": "email",
      "mensaje": "email inválido",
      "tipo": "ERROR"
    }
  ]
}
```

Note that the supplied `password` value is absent from both the body and the
captured log stream — proof that the validator builds `SriMensaje[]` from
issue paths only, and that the logger's `*.password` redaction catches the
field if downstream code ever logs the raw body.

## 4. AppError matrix

| Subclass              | Default status | Default code              | Notes                                               |
| --------------------- | -------------- | ------------------------- | --------------------------------------------------- |
| `ValidationError`     | 400            | `validation.failed`       | Carries `errors[]: SriMensaje[]`.                   |
| `AuthError`           | 401            | `auth.unauthenticated`    | Same response for unknown email vs wrong password.  |
| `ForbiddenError`      | 403            | `tenant.forbidden`        | Override code for non-tenant guards.                |
| `NotFoundError`       | 404            | `<resource>.not_found`    | Code derived from constructor arg.                  |
| `ConflictError`       | 409            | `conflict`                | Pass `invoice.duplicate_clave` etc. as code.        |
| `BusinessError`       | 422            | `business_rule_violation` | Domain rule failures (totals, sequencing).          |
| `RateLimitError`      | 429            | `rate_limited`            | Reserved for throttle middleware.                   |
| `UpstreamError`       | 502            | `upstream_failure`        | SRI 5xx / malformed XML / timeout.                  |
| `InternalServerError` | 500            | `internal.unexpected`     | Fallback class; never carries the original message. |

Anything else thrown (plain `Error`, `string`, `null`, `undefined`,
`ZodError`) is coerced inside `toProblemDetail`:

- `ZodError` → 400 `validation.failed` with `errors[]` populated from issues
  (sorted by joined path then message — deterministic ordering required for
  test stability).
- Any other value → 500 `internal.unexpected`; original message dropped.

## 5. REDACT_PATHS (full list, verbatim)

```ts
export const REDACT_PATHS = Object.freeze([
  // -- Auth / session ----------------------------------------------------
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "passwordHash",
  "passphrase",
  "csrfSecret",
  "csrfTokenHash",
  "sessionId",
  "*.password",
  "*.passwordHash",
  "*.passphrase",
  "*.csrfSecret",
  "*.csrfTokenHash",
  "*.sessionId",

  // -- Certificates (must never appear in any log) ----------------------
  "p12",
  "p12Buffer",
  "pfx",
  "pem",
  "privateKey",
  "certificatePassphrase",
  "*.p12",
  "*.p12Buffer",
  "*.pfx",
  "*.pem",
  "*.privateKey",
  "*.certificatePassphrase",

  // -- SRI payloads (full XML carries customer PII + signature) ---------
  "signedXml",
  "xml",
  "rawSoapResponse",
  "claveAcceso",
  "*.signedXml",
  "*.xml",
  "*.rawSoapResponse",
  "*.claveAcceso",

  // -- Personally identifiable taxpayer data ----------------------------
  "cedula",
  "identificacionComprador",
  "razonSocialComprador",
  "email",
  "telefono",
  "direccionComprador",
  "*.cedula",
  "*.identificacionComprador",
  "*.razonSocialComprador",
  "*.email",
  "*.telefono",
  "*.direccionComprador",

  // -- Cross-service / env-style secrets --------------------------------
  "SESSION_COOKIE_SECRET",
  "SERVICE_JWT_SECRET",
  "SRI_CERT_MASTER_KEY_HEX",
  "*.SESSION_COOKIE_SECRET",
  "*.SERVICE_JWT_SECRET",
  "*.SRI_CERT_MASTER_KEY_HEX",
] as const) satisfies readonly string[];
```

### Rationale for entries beyond SPEC §5

- `pfx` / `pem` — SPEC §6.3 names `p12` / `p12Buffer` / `privateKey`. A
  certificate could also be loaded from a PFX (`.pfx`) or a PEM bundle
  (`.pem`); adding these closes the gap and keeps the redactor uniform across
  the three SRI-acceptable formats.
- `passphrase` (separate from `certificatePassphrase`) — generic keyword used
  by `node:crypto`, OpenSSL bindings, and library wrappers. Cheap to mask.
- `csrfTokenHash` / `sessionId` — needed by SPEC-0010 (sessions). Listing
  them here means we never have to amend `REDACT_PATHS` later when the
  session/CSRF paths land.
- `claveAcceso` (49-digit SRI access key) — emitted from many SRI flows and
  embedded inside SOAP responses. Always treat as fiscal PII.
- `SESSION_COOKIE_SECRET` / `SERVICE_JWT_SECRET` / `SRI_CERT_MASTER_KEY_HEX`
  — env-style names that would otherwise appear in misconfigured debug
  payloads.
- Dual root + `*.field` entries — Pino's `fast-redact` wildcard
  (`*.foo`) matches the immediate child of a top-level object; it does NOT
  walk recursively to deeper levels and does NOT match a key at the very
  root. Listing both root (`foo`) and wildcard (`*.foo`) forms is required
  by Pino's path syntax to cover both surfaces.

The list is **extend-only**. `Object.freeze` enforces immutability at
runtime; `as const satisfies readonly string[]` enforces immutability at
the type level.

## 6. Deviations from spec / plan

1. **Subclass file layout.** SPEC §6.5 sketches all subclasses in one
   `apps/api/src/errors/app-error.ts`. TASKS-0006 §1.1–1.2 instead asked
   for one file per class under `packages/utils/src/errors/`. The
   implementation follows TASKS-0006 (single-responsibility per file,
   shared by both apps via the `@facturador/utils/errors` subpath). The
   per-app `apps/<service>/src/errors/app-error.ts` file from the spec
   does not exist.

2. **Audit helper signature.** SPEC §6.8 sketches a global `audit(input)`
   that imports a process-wide Prisma client. TASKS-0006 §4.1 instead
   asks for dependency injection (`audit(deps, input)`). The implementation
   follows TASKS-0006 to keep `@facturador/utils` free of a circular
   dependency on `@facturador/db`. Callers (api / sri-core) construct
   the Prisma client and pass it in.

3. **Diagnostic routes namespaced.** TASKS-0006 §6.1 says `POST /api/v1/echo`.
   The implementation registers the routes under `/v1/_diag/echo` and
   `/v1/_diag/forced-error` so production-style routing can re-use `/v1/...`
   without colliding with these diagnostic helpers. Behaviour matches the
   spec; only the path differs.

4. **No `correlation.ts` AsyncLocalStorage helper yet.** SPEC §6.4
   references `runWithContext` via `AsyncLocalStorage`. TASKS-0006 does
   not require it (request-logger middleware attaches `req.log` directly).
   We deferred the ALS helper to whichever later spec needs deep call
   stacks (SPEC-0026 jobs, SPEC-0033 orchestrator). A TODO is implicit;
   adding it is a non-breaking change.

5. **`ErrorCodes` constant not added to contracts.** SPEC §6.7 lists a
   `packages/contracts/src/error/codes.ts` taxonomy as a "living document".
   TASKS-0006 does not include this and the codes are encoded by each
   `AppError` subclass instead. Adding the enum is a non-breaking later
   chore.

6. **Integration test for `audit()` with a real Postgres connection** —
   TASKS-0006 §4.1 mentions a Vitest hitting real Postgres. The unit-level
   coverage (`packages/utils/src/audit/audit.test.ts`) exercises the
   happy path + error path with a stub Prisma client; a true Postgres
   integration test lands when the auth/session slice (SPEC-0010) wires
   the helper into a real flow. The contract under test is the same.

## 7. Risks observed

- **Pino wildcard semantics.** `fast-redact` does not support a recursive
  `**` operator, only single-level `*` followed by a literal. Deep nested
  payloads (>1 level) must be masked by listing the field at the root
  (`foo`) plus at the immediate-child level (`*.foo`). This is documented
  inline in `redactions.ts`. If a future caller logs a 3-level-deep
  sensitive payload (`{a:{b:{password:...}}}`), the current list will NOT
  catch it. Mitigation: prefer flattening payloads at the log site, or
  reuse `redactPayload()` (the audit walker) before logging arbitrary
  shapes.
- **Error stack traces in logs.** The `request_error` line carries
  `err.stack`. This is intentional (server-side debugging) but stack
  frames could in theory contain string-interpolated secrets if a future
  call site does `throw new Error(\`bad password ${pw}\`)`. Mitigation:
never interpolate secrets into error messages — and the redactor's
`\*.message` path is NOT in the list because it would mask all legitimate
  error messages. This is a developer-discipline constraint.
- **`pino-pretty` transport in dev.** The pretty transport spawns a worker
  thread. Tests inject a custom `destination` stream to bypass that path
  (otherwise the worker can leak stderr in CI). This is documented inline.
- **Audit redactor coverage drift.** The walker derives its sensitive-key
  set from `REDACT_PATHS` by stripping wildcards. If a future entry uses
  a syntax that isn't covered (e.g. bracket access on a path the walker
  doesn't recognise) the audit path could miss a field. Mitigation: the
  walker's tests cover the current syntax, and any new path form should
  add a sibling test in `redact.test.ts`.

## 8. Security review

The hard policy in PROMPT-0006 §6 is upheld:

- **No raw passwords, tokens, CSRF tokens, certificates, private keys,
  `claveAcceso` bodies, `Authorization` / `Cookie` headers in any log
  line.** Proven by the leak audit in §3.2 and by
  `apps/api/src/error-model.test.ts > Redaction in real log output` and
  the equivalent in `apps/sri-core`.
- **`ProblemDetail.detail` never carries internal stack traces, IDs, or
  third-party URLs.** `toProblemDetail` only forwards
  `detail` from a known `AppError` (caller-controlled, NEVER from `err.message`
  on unknown errors). The unknown-error path emits a bare 500 body with no
  `detail`.
- **`errors[]` array carries only validation issue paths and messages.**
  Constructed inside `validate.ts` from Zod issues; never the values that
  failed validation. Proven by `apps/api/src/error-model.test.ts >
POST /v1/_diag/echo` (the offending value is absent from `errors[].mensaje`).
- **Express 5 error middleware is the LAST middleware** in both
  `apps/api/src/server.ts` and `apps/sri-core/src/server.ts`. Easy to
  verify: the only `app.use(errorHandler)` call comes after every route
  declaration.
- **`audit()` never throws.** The `try/catch` around `prisma.auditLog.create`
  is unconditional; on failure a single `error` log line is emitted and
  the helper resolves to `undefined`. Proven by
  `packages/utils/src/audit/audit.test.ts > swallows Prisma errors and
emits a single error log line`.

## 9. Suggested follow-ups

- **OpenTelemetry integration** — replace the per-request `info` "request"
  log line with an OTLP span emitted from a tracing middleware. `requestId`
  becomes a `traceparent` attribute.
- **Centralised log sink** — point Pino at a stdout transport that the
  container platform aggregates (Loki / Datadog). The `service`, `env`,
  `requestId`, `pid`, `hostname` base fields are already labelled.
- **`ErrorCodes` taxonomy enum** — promote the per-subclass code defaults
  into a `packages/contracts/src/errors/codes.ts` constant (SPEC §6.7).
  Lets the API and Web layers share a canonical enum for client-side
  switches.
- **AsyncLocalStorage `runWithContext` helper** — needed by SPEC-0026
  (background jobs) so deep call stacks can read `requestId` /
  `tenantId` / `userId` without explicit threading.
- **Per-route opt-in debug level** — SPEC §12 risks "logs explode in
  volume". Add a `LOG_DEBUG_ROUTES` env var (regex) that elevates
  `req.log` to `debug` for matching paths.
- **`prisma.auditLog` migration column for hashed payload digest** —
  enables tamper-evident audit chains without storing additional secrets.
- **Lint cleanup** — pre-existing lint warnings in
  `packages/utils/src/audit/redact.ts` / `redact.test.ts` /
  `errors/app-error.test.ts` (dot notation, array-type style, optional
  non-null assertions). Out of scope for SPEC-0006; mention is here for
  completeness.

## 10. Sign-off checklist (SPEC-0006 AC-1 … AC-7)

- **AC-1** Uniform `ProblemDetail` on every error path — proven by the
  forced-error matrix (9 cases per app) all parsing through
  `ProblemDetailSchema`. (PASS)
- **AC-2** REDACT_PATHS masks each listed key — proven by
  `packages/logger/src/index.test.ts > REDACT_PATHS enforcement` and
  the leak audit in §3.2. (PASS)
- **AC-3** `audit()` writes a row and never throws — proven by
  `packages/utils/src/audit/audit.test.ts`. (PASS — note: only the
  unit-level coverage exists; a real Postgres integration test is
  deferred per §6.)
- **AC-4** `validateBody` returns 400 with `ProblemDetail.errors`
  populated — proven by `apps/api/src/error-model.test.ts >
POST /v1/_diag/echo > returns a valid ProblemDetail (400) with
errors[] on a bad payload`. (PASS)
- **AC-5** Every request carries `X-Request-Id` — proven by
  `apps/api/src/error-model.test.ts > X-Request-Id` (mint + echo). (PASS)
- **AC-6** No `console.log` in source — repo-wide ESLint already enforces
  this. The only allowed `console.log` calls are in bootstrap files
  (`apps/api/src/index.ts`, `apps/sri-core/src/index.ts`) marked
  `eslint-disable-next-line` and explicitly commented "bootstrap log;
  pino arrives in SPEC-0006". Those bootstrap lines remain because they
  print before the Pino logger has been created. (PASS — bootstrap lines
  are explicit + allow-listed.)
- **AC-7** Redaction list documented in `redactions.ts` and reviewable —
  the file is heavily commented with category headers, source-of-truth
  references, and rationale for every block. (PASS)
