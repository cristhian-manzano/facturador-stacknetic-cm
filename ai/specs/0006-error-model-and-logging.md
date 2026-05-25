---
id: SPEC-0006
title: Error model, logging, and audit trail
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002, SPEC-0004, SPEC-0005]
blocks: [SPEC-0010, SPEC-0011, SPEC-0020, SPEC-0026, SPEC-0033]
---

# SPEC-0006 — Error model, logging, and audit trail

## 1. Purpose

Define **one** error contract end-to-end, **one** logger configuration, and **one** audit log shape. This spec is the foundation for safe debugging and traceable fiscal operations. It exists so every later spec can say "use the standard logger/error model" instead of inventing its own.

## 2. Scope

### 2.1 In scope

- `AppError` class hierarchy with a stable error-code taxonomy.
- Translation layer: `AppError` → `ProblemDetail` HTTP response.
- Express 5 error middleware for API and SRI Core.
- Pino-based `@facturador/logger` package with redaction.
- Correlation ID propagation: incoming `x-request-id` (or generated ULID) → logged on every line → returned in `instance` of `ProblemDetail`.
- Audit log writes via `audit(action, payload)` helper.

### 2.2 Out of scope

- Metrics, traces (later observability spec).
- Frontend error boundary (lives in `apps/web` spec).

## 3. Context & references

- [`ai/context/security.md`](../context/security.md) — what must / must not be logged.
- [SPEC-0004](./0004-database-and-prisma.md) — `AuditLog` table.
- [SPEC-0005](./0005-shared-contracts.md) — `ProblemDetailSchema`.

## 4. Functional requirements

- **FR-1.** All API responses on errors have shape `ProblemDetail` (defined in [SPEC-0005](./0005-shared-contracts.md) §6.6).
- **FR-2.** All logs are JSON with fields: `level`, `time`, `pid`, `service`, `env`, `requestId`, `tenantId` (when known), `userId` (when known), `msg`, `err.code`, `err.stack`.
- **FR-3.** Sensitive fields are **redacted** at logger level via Pino's `redact`: passwords, certificate bytes, cookies, authorization headers, SRI XML payloads.
- **FR-4.** Every API request gets a request middleware that:
  1. Assigns/propagates `requestId` (ULID).
  2. Adds it to `req.log` (request-scoped logger).
  3. Sets header `x-request-id` on the response.
- **FR-5.** An audit helper `audit({ action, companyId?, actorUserId?, resource?, metadata?, ipHash? })` writes to the `AuditLog` table; never throws (failures emit a high-priority log).
- **FR-6.** Error codes are namespaced: `auth.invalid_credentials`, `auth.session_expired`, `tenant.forbidden`, `invoice.totals_mismatch`, `sri.devuelta`, `sri.no_autorizado`, `sri.network_error`, `sri.config_error`, etc. Full taxonomy lives in `packages/contracts/src/error/codes.ts` (added here).

## 5. Non-functional requirements

- **NFR-1.** Logger initialization adds ≤ 10 ms at boot.
- **NFR-2.** Log write latency does not block request handling (Pino is sync-by-default but cheap; OK).
- **NFR-3.** Redaction must not be optional. Misconfiguration must fail tests.

## 6. Technical design

### 6.1 `packages/logger/` layout

```
packages/logger/
├── package.json
├── src/
│   ├── index.ts            # exports createLogger, requestLogger middleware
│   ├── redactions.ts       # canonical redaction list
│   └── correlation.ts      # AsyncLocalStorage for requestId/tenantId/userId
└── test/
```

### 6.2 `createLogger`

```ts
// packages/logger/src/index.ts
import pino, { type Logger } from "pino";
import { REDACT_PATHS } from "./redactions.js";

export interface LoggerOptions {
  service: "api" | "sri-core" | "web" | "worker";
  env: "development" | "test" | "production";
  level?: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
}

export const createLogger = (opts: LoggerOptions): Logger =>
  pino({
    level: opts.level ?? (opts.env === "production" ? "info" : "debug"),
    base: { service: opts.service, env: opts.env },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
```

### 6.3 `redactions.ts` (canonical — extend, never delete)

```ts
export const REDACT_PATHS = [
  // Auth / session
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.csrfSecret",
  // Certificates
  "*.p12",
  "*.p12Buffer",
  "*.privateKey",
  "*.certificatePassphrase",
  // SRI payloads — never log full XML
  "*.signedXml",
  "*.xml",
  "*.rawSoapResponse",
  // PII
  "*.cedula",
  "*.identificacionComprador",
  "*.razonSocialComprador",
  "*.email",
  "*.telefono",
  "*.direccionComprador",
];
```

PII redaction is conservative: when a tenant administrator needs to debug a specific customer interaction, they go to the audit log (which stores minimal, structured data), not log files.

### 6.4 Request logger middleware (Express 5)

```ts
// apps/api/src/middleware/request-logger.ts
import type { RequestHandler } from "express";
import { ulid } from "ulid";
import { logger } from "../logger.js";
import { runWithContext } from "@facturador/logger/correlation";

export const requestLogger: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const requestId = incoming && /^[0-9A-Z]{26}$/i.test(incoming) ? incoming : ulid();
  res.setHeader("x-request-id", requestId);

  const child = logger.child({ requestId });
  (req as any).log = child;

  const start = Date.now();
  res.on("finish", () => {
    child.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      },
      "request",
    );
  });

  runWithContext({ requestId }, () => next());
};
```

`runWithContext` uses `AsyncLocalStorage` to make `requestId` (and later `tenantId`, `userId` after auth middleware) available to deep call stacks without explicit threading.

### 6.5 `AppError` hierarchy

```ts
// apps/api/src/errors/app-error.ts (mirrored in apps/sri-core)
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly detail?: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: Record<string, string[]>) {
    super("validation.failed", 400, "Validation failed", undefined, fieldErrors);
  }
}

export class AuthError extends AppError {
  constructor(code: string, message = "Authentication required") {
    super(code, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(code = "tenant.forbidden", message = "Forbidden") {
    super(code, 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource}.not_found`, 404, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, 409, message);
  }
}

export class UpstreamError extends AppError {
  constructor(
    code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(code, 502, message);
  }
}
```

### 6.6 Express 5 error middleware

```ts
// apps/api/src/middleware/error-handler.ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, ValidationError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = res.getHeader("x-request-id") as string | undefined;
  const log = (req as any).log ?? console;

  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    appErr = new ValidationError(fieldErrors);
  } else {
    appErr = new AppError("internal.unexpected", 500, "Internal Server Error");
    log.error({ err }, "unhandled error");
  }

  res.status(appErr.status).json({
    type: `urn:facturador:error:${appErr.code}`,
    title: appErr.message,
    code: appErr.code,
    status: appErr.status,
    detail: appErr.detail,
    instance: requestId,
    errors: appErr.errors,
  });
};
```

### 6.7 Error code taxonomy (`packages/contracts/src/error/codes.ts`)

> Living document. Every new spec **adds** codes here; renames require an ADR.

```ts
export const ErrorCodes = {
  // generic
  VALIDATION_FAILED: "validation.failed",
  INTERNAL_UNEXPECTED: "internal.unexpected",

  // auth
  AUTH_INVALID_CREDENTIALS: "auth.invalid_credentials",
  AUTH_SESSION_EXPIRED: "auth.session_expired",
  AUTH_CSRF_INVALID: "auth.csrf_invalid",

  // tenants
  TENANT_FORBIDDEN: "tenant.forbidden",
  TENANT_NOT_A_MEMBER: "tenant.not_a_member",
  TENANT_SWITCH_INVALID: "tenant.switch_invalid",

  // certificates
  CERT_NOT_FOUND: "certificate.not_found",
  CERT_EXPIRED: "certificate.expired",
  CERT_PASSPHRASE_INVALID: "certificate.passphrase_invalid",

  // invoices / domain
  INVOICE_TOTALS_MISMATCH: "invoice.totals_mismatch",
  INVOICE_SEQUENTIAL_GAP: "invoice.sequential_gap",
  INVOICE_DUPLICATE_CLAVE: "invoice.duplicate_clave",

  // SRI
  SRI_DEVUELTA: "sri.devuelta",
  SRI_NO_AUTORIZADO: "sri.no_autorizado",
  SRI_EN_PROCESO: "sri.en_proceso",
  SRI_NETWORK: "sri.network",
  SRI_CONFIG: "sri.config",
  SRI_ALREADY_RECEIVED: "sri.already_received",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

### 6.8 Audit log helper

```ts
// apps/api/src/audit/audit.ts
import { prisma } from "../db/client.js";
import { ulid } from "ulid";
import { logger } from "../logger.js";

export interface AuditInput {
  action: string;
  companyId?: string | null;
  actorUserId?: string | null;
  resource?: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}

export const audit = async (input: AuditInput): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        id: ulid(),
        action: input.action,
        companyId: input.companyId ?? null,
        actorUserId: input.actorUserId ?? null,
        resource: input.resource,
        metadata: input.metadata ?? {},
        ipHash: input.ipHash ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "audit write failed");
  }
};
```

**Canonical action names** (extend per spec; never overlap):

- `auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.session.revoked`
- `tenant.switched`
- `certificate.uploaded`, `certificate.activated`, `certificate.revoked`
- `invoice.created`, `invoice.emitted.recibida`, `invoice.emitted.autorizado`, `invoice.emitted.devuelta`, `invoice.emitted.no_autorizado`
- `sri.recepcion.sent`, `sri.autorizacion.queried`

### 6.9 Logger initialization per app

`apps/api/src/logger.ts`:

```ts
import { createLogger } from "@facturador/logger";
import { env } from "./env.js";
export const logger = createLogger({ service: "api", env: env.NODE_ENV, level: env.LOG_LEVEL });
```

Same pattern in `apps/sri-core/src/logger.ts` with `service: "sri-core"`.

## 7. Implementation guide

### 7.1 Steps

1. Scaffold `packages/logger/` per §6.1.
2. Add `pino` and `pino-pretty` (dev only) to `@facturador/logger`.
3. Implement `createLogger`, `correlation.ts` (AsyncLocalStorage helpers).
4. Add `apps/api/src/middleware/request-logger.ts` and `error-handler.ts`.
5. Mirror `apps/sri-core/src/middleware/*` with appropriate service name.
6. Add `apps/api/src/errors/app-error.ts` and `apps/api/src/audit/audit.ts`.
7. Append the `ErrorCodes` constant to `@facturador/contracts` (re-export from `@facturador/contracts/error`).
8. Wire middlewares: `app.use(requestLogger)` first; `app.use(errorHandler)` last.

### 7.2 Dependencies

| Workspace                   | Package       | Version         | Purpose        |
| --------------------------- | ------------- | --------------- | -------------- |
| `packages/logger`           | `pino`        | `^9.4.0`        | Logger.        |
| `packages/logger` (dev)     | `pino-pretty` | `^11.2.2`       | Dev formatter. |
| `apps/api`, `apps/sri-core` | `ulid`        | (already added) | Request IDs.   |

### 7.3 Conventions

- **Never** `console.log` in production code (ESLint-enforced in [SPEC-0002](./0002-shared-tooling.md)).
- **Never** log raw request/response bodies of fiscal payloads.
- **Never** swallow errors silently — at minimum `log.warn({ err }, "...")`.
- **Always** use the `audit()` helper for fiscal/sensitive events.

## 8. Acceptance criteria

- **AC-1.** A `400` request to API returns a `ProblemDetail` body that matches `ProblemDetailSchema.parse(...)`.
- **AC-2.** A `500` response has `code: "internal.unexpected"`, no stack trace in the body.
- **AC-3.** Logs are JSON-parseable; each line contains `requestId`, `service`, `env`.
- **AC-4.** A log entry with `password: "abc"` in metadata reports `password: "[REDACTED]"`.
- **AC-5.** A log entry with `signedXml: "<...>"` reports `signedXml: "[REDACTED]"`.
- **AC-6.** Throwing a `ZodError` from a handler results in a 400 with `errors` populated.
- **AC-7.** `audit()` writes a row even if metadata is undefined.
- **AC-8.** Audit log row never contains `password*`, `*.p12`, or `signedXml*` keys (assertion in tests).

## 9. Test plan

- Unit tests for `redactions.ts` configuration — try a few sample log lines.
- Integration test on Express app: post bad payload → assert ProblemDetail shape.
- Integration test for `audit()` against a throwaway schema.

## 10. Security considerations

- Stack traces never returned in `ProblemDetail`. Logs may contain them; user responses must not.
- Errors must never leak whether a user/email/RUC exists. Auth handler returns `auth.invalid_credentials` for both unknown email and bad password (see [SPEC-0010](./0010-authentication-and-sessions.md)).
- Audit log is the **only** persistent record of who-did-what-when for fiscal actions. Make `metadata` redact-safe by convention: store IDs, not bodies.

## 11. Observability

- Logs go to stdout (12-factor). Container platform aggregates.
- Future spec adds metrics (`req_duration_seconds`, `sri_call_latency_seconds`).

## 12. Risks and mitigations

| Risk                                        | Mitigation                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Redaction list misses a new sensitive field | Quarterly review; mandate spec authors to update redactions when adding new fiscal/PII fields. |
| Logs explode in volume                      | Pino at `info` level in prod; per-route opt-in to `debug`.                                     |
| Audit log table grows unboundedly           | Retention policy follows tax law (7 years for fiscal events). Index keeps queries fast.        |

## 13. Open questions

- OpenTelemetry now or later? Later — see future observability spec.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
