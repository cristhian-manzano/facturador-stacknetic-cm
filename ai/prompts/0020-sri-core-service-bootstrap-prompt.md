---
id: PROMPT-0020
spec: SPEC-0020
plan: PLAN-0020
tasks: TASKS-0020
title: Execute TASKS-0020 — SRI Core service bootstrap
---

# PROMPT-0020 — Execute SRI Core service bootstrap

You are an autonomous senior backend engineer with deep TypeScript + Express + JWT + multi-tenant experience. Execute **TASKS-0020**: stand up the SRI Core service, its Prisma models, service-to-service JWT auth, the public emit/status/resend API surface, and the state-machine skeleton (no real SOAP yet; stub mode for dev).

---

## 1. Mandatory reading

1. `ai/specs/0020-sri-core-service-bootstrap.md` — authoritative.
2. `ai/plans/0020-sri-core-service-bootstrap-plan.md`.
3. `ai/tasks/0020-sri-core-service-bootstrap-tasks.md`.
4. `ai/specs/0004-database-and-prisma.md` — shared Prisma.
5. `ai/specs/0005-shared-contracts.md` — service-to-service shapes.
6. `ai/specs/0006-error-model-and-logging.md` — ProblemDetail, audit.
7. `ai/specs/0026-document-lifecycle-and-jobs.md` — state machine matrix.
8. `ai/context/security.md` — service JWT secret rules, never log certs.
9. `ai/context/sri-domain.md` — high-level lifecycle context.
10. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the routes / models / middleware listed in TASKS-0020.
- ❌ Do NOT implement real XAdES-BES signing, real SOAP clients, polling job, or certificate envelope crypto. Those belong to SPECs 0021–0026.
- ❌ Do NOT expose certificate bytes via any response.
- ❌ Do NOT introduce a second JWT verifier alg path; HS256 only.
- ❌ Do NOT allow stub mode in production.

## 3. Stack constraints

- Express 5.
- Prisma 5 with the same `prisma/schema.prisma` extended.
- HS256 JWT via `jsonwebtoken` (or `jose`). Pin major version.
- Zod for env + body validation.
- Pino logger from `@facturador/logger`.

## 4. Code quality bar

- `verifyServiceJwt` rejects alg-confusion attacks (`alg:none`, `alg:RS256` with the HMAC secret).
- The body `companyId` must equal the JWT `sub`; mismatched → 403, never 200.
- All DB writes through `recordEvent`; no direct `estado` mutation elsewhere (a lint comment or simple code-review note suffices for v1 — document in review).
- All persistence scoped to `companyId`; absent or mismatched scope is treated as 403/404 per spec.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/sri-core test` exits 0.
- Integration test mints a real JWT in api code, calls sri-core, gets a real persisted document + events.
- Negative tests: missing token, wrong aud, alg:none, sub mismatch — each returns the expected status.
- Idempotency: same claveAcceso twice → one row.
- Stub mode happy path produces AUTORIZADO; production+stub refuses boot.
- `curl -fsS http://localhost:3100/healthz` against the running compose service returns 200.

## 6. Security considerations

- `SERVICE_JWT_SECRET` is base64-encoded 256-bit; loaded only in env.ts; redacted in logger.
- Tokens expire ≤ 60 s; clock skew tolerance ≤ 5 s (configure `clockTolerance: 5`).
- Tokens carry no PII (just `companyId` ULID).
- Certificate columns are never serialized into log lines (REDACT_PATHS already covers `p12*`).
- `SriDocument.signedXmlBlobKey` references a blob store key (not the bytes); the bytes themselves are stored via SPEC-0026's BlobStore interface (not implemented in this slice). For now, leave the field nullable.
- The audit log records emit attempts (companyId, claveAcceso, outcome) — never tokens.

## 7. Deliverables

When TASKS-0020 is green, write `ai/reviews/0020-sri-core-service-bootstrap-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test output (unit + integration).
   - Migration SQL snippet.
   - `curl -H "Authorization: Bearer $TOKEN" -i localhost:3100/v1/documents/.../status` headers.
4. **Negative-path matrix** — table of attack vector → status code returned.
5. **State machine matrix** — paste the (from→to) table as implemented.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., shared secret rotation strategy.
8. **Security review** — confirm each item in §6.
9. **Suggested follow-ups** — move JWT verification to `jose` if not already; move secret to KMS; add per-request rate limit.
10. **Sign-off checklist** — SPEC-0020 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; full audit in the review file.

## 9. Exit condition

- All TASKS-0020 boxes ticked.
- api ↔ sri-core round-trip green in stub mode.
- Review file complete.

Begin.
