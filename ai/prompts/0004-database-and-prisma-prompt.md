---
id: PROMPT-0004
spec: SPEC-0004
plan: PLAN-0004
tasks: TASKS-0004
title: Execute TASKS-0004 — Database & Prisma baseline
---

# PROMPT-0004 — Execute database & Prisma baseline

You are an autonomous senior backend engineer with deep PostgreSQL + Prisma + security background. Execute **TASKS-0004**: scaffold the Prisma schema, generate the first migration, write an idempotent seed, and wire the API to a real `/health-db` endpoint backed by Postgres.

---

## 1. Mandatory reading

1. `ai/specs/0004-database-and-prisma.md` — authoritative.
2. `ai/plans/0004-database-and-prisma-plan.md`.
3. `ai/tasks/0004-database-and-prisma-tasks.md`.
4. `ai/specs/0001-monorepo-and-workspace.md` and `ai/specs/0003-docker-and-local-dev.md` (prereqs).
5. `ai/context/security.md` — argon2id, multi-tenant isolation, redaction.
6. `ai/decisions/ADR-0004-auth-session-strategy.md` — server-side sessions.
7. `ai/context/glossary.md` — Spanish field names (`ruc`, `razonSocial`, `ambiente`, etc.) must be used verbatim.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Create only the identity / audit / session models in this slice.
- ❌ Do NOT add Certificate, SriDocument, SriEvent, Invoice, Customer, EmissionPoint models — those belong to later specs.
- ❌ Do NOT add Row-Level Security policies (separate later spec).
- ❌ Do NOT use `prisma db push` anywhere; only `migrate dev` and `migrate deploy`.
- ❌ Do NOT ship `.env` with real values; the dev `.env` derives from `.env.example`.
- ❌ Never commit secrets or seeded plaintext passwords.

## 3. Stack constraints

- Prisma 5.x, `@prisma/client` matching.
- PostgreSQL 16 (Docker compose service from SPEC-0003).
- argon2 (`type: argon2id`, `memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`).
- ULID PKs (`@db.Char(26)`; generate with `ulid()` at app layer).
- TypeScript strict; ESM; tsx for seed.

## 4. Code quality bar

- Models use Spanish domain field names verbatim where applicable (`ruc`, `razonSocial`, `ambiente`, `tipoEmision`, `direccionMatriz`, `obligadoContabilidad`).
- Every FK declares an explicit `onDelete` (default to `Restrict`).
- Every model that will be queried by a column has an explicit `@@index`.
- Migration SQL is reviewed before commit; no trailing diffs in `migration.sql`.
- `prisma/seed.ts` uses `upsert` for every row to guarantee idempotency.
- Logging in seed prints summary only — never the plaintext password.

## 5. Validation requirement (the user's hard rule)

You must demonstrate, with real commands:

- `pnpm prisma validate` exits 0.
- `pnpm prisma migrate dev --name init` against the Compose Postgres succeeds; the migration SQL is reviewed.
- `pnpm prisma db seed` is run **twice in a row** — second run does not duplicate rows. Capture row counts before / after.
- `curl localhost:3000/health-db` returns 200 with body `{"db":"ok"}`.
- The Vitest integration test in `apps/api/src/health-db.test.ts` (or equivalent) passes.
- The argon2 verification test passes (hash of `Admin123!` verifies true, wrong password verifies false).

If any of those fails, the task is not done.

## 6. Security considerations

- Password column is `passwordHash`. Never `password`. Reasoning: lower risk of accidental log inclusion.
- argon2id parameters MUST meet or exceed OWASP 2024 minimum: `memoryCost ≥ 64 MB`, `timeCost ≥ 3`, `parallelism ≥ 1`.
- Email stored lowercased at the app layer (you may add a tiny normalization helper). Do not rely solely on DB-level case folding.
- Seed must read `SEED_ADMIN_PASSWORD` from env (with a default acceptable for dev only, but the default must NOT be a common weak password — `Admin123!` is acceptable as a dev placeholder but must be flagged as non-production in the review).
- The schema must NEVER include a `password` (plaintext) column.
- Audit log payload column is `Json?`; document in the review that any sensitive payload writers must redact before insert.

## 7. Deliverables

When TASKS-0004 is green, write `ai/reviews/0004-database-and-prisma-review.md` with these sections:

1. **Summary**.
2. **Files created / changed** — absolute paths.
3. **Validation evidence**:
   - `pnpm prisma validate` output.
   - `pnpm prisma migrate dev` output (the `migration.sql` snippet showing key CREATE TABLEs).
   - Row counts before and after a second seed run (must be equal).
   - `curl -i localhost:3000/health-db` headers + body.
   - Test runner output.
4. **Schema review**:
   - Confirm every business model has an explicit indexable column.
   - List every FK and its `onDelete` policy.
5. **Deviations from spec/plan**.
6. **Risks observed** — e.g., "Citext not available — using lowercase normalization at app layer".
7. **Security review** — confirm argon2id params, confirm no plaintext password anywhere in source or seed, confirm `Session` table is keyed by ULID, confirm `email` is unique + lowercased before insert.
8. **Suggested follow-ups** — e.g., add RLS policies in a later spec; add pgbouncer wiring before production.
9. **Sign-off checklist** — SPEC-0004 AC-1…AC-7 with ✅/❌.

## 8. Communication style

Concise chat updates; details in the review file.

## 9. Exit condition

- TASKS-0004 fully checked off.
- Idempotent seed verified.
- `/health-db` reachable and green.
- Review file written.

Begin.
