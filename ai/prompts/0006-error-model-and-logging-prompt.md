---
id: PROMPT-0006
spec: SPEC-0006
plan: PLAN-0006
tasks: TASKS-0006
title: Execute TASKS-0006 — Error model & logging
---

# PROMPT-0006 — Execute error model & logging

You are an autonomous senior platform engineer with deep expertise in Express, Pino, and secure logging. Execute **TASKS-0006**: build the uniform `ProblemDetail` error shape, the typed AppError hierarchy, the Pino-based logger with redaction, request-id middleware, validation middleware, and the audit helper.

---

## 1. Mandatory reading

1. `ai/specs/0006-error-model-and-logging.md` — authoritative.
2. `ai/plans/0006-error-model-and-logging-plan.md`.
3. `ai/tasks/0006-error-model-and-logging-tasks.md`.
4. `ai/specs/0005-shared-contracts.md` — `ProblemDetailSchema` lives here.
5. `ai/specs/0004-database-and-prisma.md` — `AuditLog` model.
6. `ai/context/security.md` — REDACT_PATHS list; never log certs, passwords, tokens, signed XML, cookies.
7. `ai/specs/0002-shared-tooling.md` — lint rules already block `console.log` and raw `process.env`.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Implement only what TASKS-0006 lists.
- ❌ Do not implement real auth, business endpoints, or SRI logic here.
- ❌ Never weaken the redaction list to make a test pass — change the logged payload instead.
- ❌ Do not throw inside `audit()`; the audit helper must be safe to call from any path.
- ❌ Do not register the error middleware before routes — it MUST be last.

## 3. Stack constraints

- Express 5 (async handlers natively supported; you may still wrap with try/catch if clearer).
- Pino 9.x, `pino-pretty` for dev only.
- ULIDs for request IDs (`ulid` package).
- Zod for validation; `ProblemDetailSchema` from `@facturador/contracts/errors`.
- TypeScript strict; ESM only.

## 4. Code quality bar

- AppError subclasses each export their own file (single-responsibility).
- `toProblemDetail` is pure: same input → same output; no clock reads.
- `validateBody` maps Zod issues to `SriMensaje[]` deterministically (stable ordering by issue path).
- Logger never imports from app code; app code always imports from logger.
- `audit()` swallow exceptions but emits a single `error` log line on failure.

## 5. Validation requirement (the user's hard rule)

You must demonstrate, with real test runs:

- `pnpm --filter @facturador/utils test` exits 0 — covers AppError + `toProblemDetail` + audit.
- `pnpm --filter @facturador/logger test` exits 0 — covers redaction.
- `pnpm --filter @facturador/api test` exits 0 — covers request-id, error-handler, validate, forced-error routes.
- Identical tests pass for `apps/sri-core`.
- For redaction: capture a log line with `{ signedXml, password, passwordHash, nested: { privateKey, ok: 1 } }`. Each sensitive key is `[REDACTED]`; `ok: 1` is preserved.

If any check fails, fix the cause; do not skip.

## 6. Security considerations (verbatim from project policy)

- Never log: `.p12`, `.pfx`, `.pem`, `.privateKey`, `signedXml`, `passphrase`, `password`, `passwordHash`, `SESSION_*` cookie values, `Authorization` headers, `Cookie` / `Set-Cookie` headers, `SERVICE_JWT_SECRET`, `SRI_CERT_MASTER_KEY_HEX`.
- Audit payloads must be passed through a redactor before insert. Document in the review which redactor variant you used.
- Error messages exposed to the client (`ProblemDetail.detail`) MUST NOT contain internal stack traces, internal IDs, or third-party API URLs. The stack trace is logged server-side only.
- `errors` array in `ProblemDetail` is for validation issues only; never include sensitive values that the client submitted.

## 7. Deliverables

When TASKS-0006 is green, write `ai/reviews/0006-error-model-and-logging-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test runner output for utils, logger, api, sri-core.
   - A snippet of a real log line proving redaction works.
   - A snippet of a real ProblemDetail JSON response from a forced-error route.
4. **AppError matrix** — table of subclass → status → code.
5. **REDACT_PATHS** — full list, with a rationale for any path added beyond SPEC §5.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., "nested redact paths require Pino-specific syntax; documented".
8. **Security review** — confirm the policy from §6 is upheld; quote the JSON of a sample log line and a sample ProblemDetail.
9. **Suggested follow-ups** — e.g., OpenTelemetry integration; centralised log sink.
10. **Sign-off checklist** — SPEC-0006 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise in chat; full audit in the review file.

## 9. Exit condition

- All TASKS-0006 boxes ticked.
- Redaction proven; ProblemDetail proven; audit row proven.
- Review file complete.

Begin.
