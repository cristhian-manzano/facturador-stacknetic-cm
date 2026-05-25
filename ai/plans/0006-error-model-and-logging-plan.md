---
id: PLAN-0006
spec: SPEC-0006
title: Error model & logging — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0006 — Error model & logging

> Implementation plan for [SPEC-0006](../specs/0006-error-model-and-logging.md). Depends on PLAN-0001/0002/0005.

## 1. Goal

Provide one uniform error shape (`ProblemDetail`) end-to-end and one Pino logger with comprehensive redaction. After this slice:

- Every Express error path serializes a `ProblemDetail` JSON body.
- Every log call goes through `@facturador/logger`; no `console.log` exists in app code (lint already enforces).
- A redaction list strips secrets (`.p12`, `signedXml`, `privateKey`, cookies, etc.) **at the logger level**.
- An `audit(...)` helper writes durable rows to the `AuditLog` table (from SPEC-0004).
- A `validateBody`/`validateQuery` middleware in `apps/api` uses contracts and emits `ProblemDetail` on failure.

## 2. Inputs

- [SPEC-0006](../specs/0006-error-model-and-logging.md) — authoritative.
- [SPEC-0005](../specs/0005-shared-contracts.md) — `ProblemDetailSchema` lives there.
- [SPEC-0004](../specs/0004-database-and-prisma.md) — `AuditLog` model.
- [ai/context/security.md](../context/security.md) — REDACT_PATHS list source.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                                  | Rationale                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **One AppError hierarchy** in `@facturador/utils/errors`: `AppError` (abstract) → `ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `UpstreamError`, `BusinessError`. | Predictable mapping to HTTP status + `code` string. |
| **Pino** with `redact` paths configured globally; each app calls `createLogger({ service })`.                                                                                                                             | Single dep, fast, JSON-by-default.                  |
| Logger lives in `@facturador/logger`; constants in `redactions.ts`.                                                                                                                                                       | Keeps the redaction list in one diffable file.      |
| `audit(event)` writes to the `AuditLog` table via Prisma; also emits an `info` log with the same payload (minus PII).                                                                                                     | Durable + observable.                               |
| Express 5 error middleware translates any unhandled error to `ProblemDetail` (500 by default; AppError instances map deterministically).                                                                                  | One layer for the whole API.                        |
| Request id middleware sets `req.id` (ULID); included in every log line and ProblemDetail `instance`.                                                                                                                      | Traceable cross-service.                            |
| Service-to-service calls between api ↔ sri-core forward `X-Request-Id`.                                                                                                                                                  | End-to-end tracing.                                 |

## 4. Phases

### Phase 1 — `@facturador/utils/errors`

1. Add `packages/utils/src/errors/` directory.
2. Abstract `AppError extends Error` with `status: number`, `code: string`, `detail?: string`, `errors?: SriMensaje[]`.
3. Concrete subclasses with default status:
   - `ValidationError` (400, `validation_failed`).
   - `AuthError` (401, `unauthenticated`).
   - `ForbiddenError` (403, `forbidden`).
   - `NotFoundError` (404, `not_found`).
   - `ConflictError` (409, `conflict`).
   - `RateLimitError` (429, `rate_limited`).
   - `UpstreamError` (502, `upstream_failure`).
   - `BusinessError` (422, `business_rule_violation`).
4. Helper `toProblemDetail(err: unknown, requestId?: string): ProblemDetail`.

### Phase 2 — `@facturador/logger`

1. Add deps: `pino`, `pino-pretty` (dev only).
2. `src/redactions.ts`: export `REDACT_PATHS = ["*.p12", "*.pfx", "*.pem", "*.privateKey", "*.passphrase", "*.signedXml", "req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "*.password", "*.passwordHash", "*.SESSION_*", "*.SERVICE_JWT_SECRET", "*.SRI_CERT_MASTER_KEY_HEX"]`.
3. `src/index.ts`: export `createLogger({ service: string })` returning a Pino logger with redact paths, base bindings (`service`, `pid`, `hostname`), and `transport: { target: "pino-pretty" }` when `NODE_ENV !== "production"`.
4. Export `withRequest(logger, req)` returning a child logger bound to `req.id`.

### Phase 3 — Express 5 error middleware (api + sri-core)

Each app gets:

1. `src/middleware/request-id.ts`: assigns `req.id` from `X-Request-Id` header or generates ULID.
2. `src/middleware/error-handler.ts`: catches any thrown error in routes; uses `toProblemDetail`; status from `err.status` else 500; body is a `ProblemDetail`.
3. `src/middleware/validate.ts`: `validateBody(schema)` returns an Express handler that runs `schema.safeParse(req.body)` and throws `ValidationError` on failure with `errors` populated.

### Phase 4 — Audit helper

1. `packages/utils/src/audit.ts`: `audit({ action, entity, entityId?, companyId?, actorUserId?, ip?, userAgent?, payloadJson? })` → writes to AuditLog via Prisma (injected client to avoid circular dep — or use a small adapter pattern).
2. The helper also emits `logger.info({ event: "audit", action, entity, entityId })` — no PII.

### Phase 5 — Wiring & verification

- Update `apps/api/src/server.ts` to attach: request-id → logger child → routes → error-handler (last).
- Same for `apps/sri-core/src/server.ts`.
- Add tests:
  - `error-handler.test.ts`: throwing `AuthError` from a stub route returns 401 + `ProblemDetail` body with `code: unauthenticated`.
  - `redaction.test.ts`: logger output of a payload containing `{ signedXml: "<xml/>", password: "secret" }` masks both fields.
  - `audit.test.ts`: calling `audit(...)` writes a row; reading back validates.

## 5. Risks & mitigations

| Risk                                                | Mitigation                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pino redact paths miss a new secret.                | Code review on every new sensitive field; redaction tests assert each known sensitive key is masked. |
| Async errors bypass the handler.                    | Express 5 supports async handlers natively; document the pattern; lint via custom rule later.        |
| `audit()` failures cascade and break business flow. | Wrap in try/catch; log the failure; do not throw.                                                    |
| `pino-pretty` accidentally loaded in production.    | Conditional `transport` only when `NODE_ENV !== "production"`.                                       |
| Request-id collision across services.               | ULIDs are sortable + unique enough; cross-service correlation via the same header.                   |

## 6. Validation strategy

- Every middleware has a Vitest test.
- A Supertest integration test asserts: `POST /api/v1/auth/login` with `{ email: "x", password: "" }` returns 400 + `ProblemDetail` shaped per Zod (round-trip through schema).
- Redaction test parses a log line (JSON) and asserts the redacted fields are `[REDACTED]`.
- Audit test queries the row and asserts it matches.

## 7. Exit criteria

- All SPEC-0006 acceptance criteria pass.
- No `console.log` in source (lint already enforces).
- All production log paths go through `createLogger`.

## 8. Out of scope

- Distributed tracing (OpenTelemetry) — later.
- Log shipping to an external system — later.
- Localised error titles — Spanish only for v1.
