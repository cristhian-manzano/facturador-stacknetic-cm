---
id: REVIEW-0004
spec: SPEC-0004
plan: PLAN-0004
tasks: TASKS-0004
prompt: PROMPT-0004
title: Database & Prisma baseline — implementation review
status: complete
created: 2026-05-20
owner: Claude Opus 4.7
---

# REVIEW-0004 — Database & Prisma baseline

## 1. Summary

Established the Prisma 5 baseline for the monorepo: schema, migration, idempotent seed, shared client workspace, and `/health-db` readiness probe. The slice ships only the **identity / audit / session models** required by SPEC-0004 — Certificate, Invoice, Customer, EmissionPoint, SriDocument, SriEvent remain out of scope per the SPEC index.

Highlights:

- New workspace `@facturador/db` owns the schema (`prisma/schema.prisma`), seed (`prisma/seed.ts`), generated client wrapper (`src/index.ts`), and a tiny env loader (`src/env.ts`).
- Six models created: `Company`, `User`, `Membership`, `Session`, `AuditLog` + `enum Role`. Spanish-domain field names retained verbatim per `ai/context/glossary.md`.
- Initial migration `20260521011640_init` applied against the compose Postgres on `localhost:5432`.
- Seed run twice with identical row counts and identical row IDs (idempotent by unique business key).
- `GET /health-db` is wired into `apps/api` and returns `200 {"db":"ok"}` on a live DB; returns `503 {"db":"down"}` when Postgres is unreachable (no error message body — see security review).
- argon2id hashing uses the OWASP 2024 floor `{ memoryCost: 65_536, timeCost: 3, parallelism: 1 }` and is verified by a dedicated test against the seeded admin.

No commits were made (per the explicit constraint).

## 2. Files created / changed

### 2.1 Created

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/package.json`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/tsconfig.json`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/tsconfig.build.json`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/eslint.config.js`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/src/index.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/src/env.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/schema.prisma`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/seed.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/migrations/migration_lock.toml`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/migrations/20260521011640_init/migration.sql`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/test/db-smoke.test.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/health-db.test.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/ai/reviews/0004-database-and-prisma-review.md` (this file)

### 2.2 Modified

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/.env` — `DATABASE_URL` switched from `db:5432` to `localhost:5432` (host-workstation default for `prisma migrate`, `vitest`).
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/.env.example` — same change + comment clarifying that compose overrides for in-container services.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/docker-compose.yml` — added explicit `DATABASE_URL: postgresql://...@db:5432/...` overrides under `services.api.environment` and `services.sri-core.environment`. Formatted by Prettier.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/server.ts` — added `GET /health-db` and DI-style `createApp({ prisma })`. Preserved `GET /health`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/package.json` — added `@facturador/db` + `@facturador/contracts` deps, `dotenv-cli` + `vitest` devDeps, wrapped `dev`/`test` with `dotenv -e ../../.env --`.

## 3. Validation evidence

### 3.1 `pnpm prisma validate`

```
> @facturador/db@0.0.0 prisma:validate
> dotenv -e ../../.env -- prisma validate

Prisma schema loaded from prisma/schema.prisma
The schema at prisma/schema.prisma is valid 🚀
```

Exit code 0.

### 3.2 `pnpm prisma migrate dev`

```
> dotenv -e ../../.env -- prisma migrate dev --name init

Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "facturador", schema "public" at "localhost:5432"

Applying migration `20260521011640_init`

The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20260521011640_init/
    └─ migration.sql

Your database is now in sync with your schema.

Running generate...
✔ Generated Prisma Client (v5.22.0) ...
```

Subsequent runs report:

```
Already in sync, no schema change or pending migration was found.
```

Key migration SQL excerpts (full file: `packages/db/prisma/migrations/20260521011640_init/migration.sql`):

```sql
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'OPERATOR', 'VIEWER');

CREATE TABLE "Company" (
    "id" CHAR(26) NOT NULL,
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "ambiente" TEXT NOT NULL,
    "tipoEmision" TEXT NOT NULL,
    "direccionMatriz" TEXT NOT NULL,
    "contribuyenteEspecial" TEXT,
    "obligadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_ruc_key" ON "Company"("ruc");
CREATE INDEX "Company_deletedAt_idx" ON "Company"("deletedAt");

CREATE TABLE "User" (
    "id" CHAR(26) NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es-EC',
    "isSuperadmin" BOOLEAN NOT NULL DEFAULT false,
    ...
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Membership" (...);
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Session" (...);
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

CREATE TABLE "AuditLog" (...);
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`prisma migrate status` reports "Database schema is up to date".

### 3.3 Idempotent seed — row counts before and after a second run

| Run               | companies | users | memberships | Stdout                                                                              |
| ----------------- | --------- | ----- | ----------- | ----------------------------------------------------------------------------------- |
| First             | 1         | 1     | 1           | `Seed complete: company=01KS41TDMRCGSB29H59CCTB4XE user=01KS41TDNA005ZH1AWN44YWV3N` |
| Second (no reset) | 1         | 1     | 1           | `Seed complete: company=01KS41TDMRCGSB29H59CCTB4XE user=01KS41TDNA005ZH1AWN44YWV3N` |

Identical IDs because every row is upserted by its business key (`ruc`, `email`, `(userId, companyId)`). No diff in row counts.

### 3.4 `curl -i localhost:3000/health-db`

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 11
ETag: W/"b-gekxFC0I+/n/yaVbmBakHSgjGb4"
Date: Thu, 21 May 2026 01:44:28 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"db":"ok"}
```

When DB is unreachable (verified earlier by deliberately omitting `DATABASE_URL`):

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
Content-Length: 13

{"db":"down"}
```

### 3.5 Test runner output

`pnpm --filter @facturador/db test`:

```
✓ test/db-smoke.test.ts  (3 tests) 289ms
Test Files  1 passed (1)
     Tests  3 passed (3)
```

Tests in `@facturador/db`:

- `creates and reads back Company, User, and Membership` — CRUD round-trip via Prisma, including a User→Memberships→Company join. Asserts ULID format and that `passwordHash.startsWith("$argon2id$")`.
- `enforces unique RUC on Company` — re-insertion is rejected with `Prisma.PrismaClientKnownRequestError` (intentional `prisma:error` log line in stdout).
- `verifies the seeded admin password and rejects a wrong one` — `argon2.verify(hash, "Admin123!") === true`, `argon2.verify(hash, "wrong-password") === false`.

`pnpm --filter @facturador/api test`:

```
✓ src/health-db.test.ts  (1 test) 26ms
✓ src/server.test.ts  (1 test) 9ms
Test Files  2 passed (2)
     Tests  2 passed (2)
```

`/health-db` test exercises the real Prisma + Express stack against the dev Postgres.

### 3.6 Finishing-line validations (all exit 0)

| Validation                                                | Result              |
| --------------------------------------------------------- | ------------------- |
| `pnpm install`                                            | exit 0 — pass       |
| `pnpm --filter @facturador/db prisma:migrate`             | exit 0 — pass       |
| `pnpm --filter @facturador/db prisma:generate`            | exit 0 — pass       |
| `pnpm --filter @facturador/db seed` (×2, idempotent)      | exit 0 — pass       |
| `pnpm --filter @facturador/db test` (CRUD smoke + argon2) | exit 0 — pass (3/3) |
| `pnpm -r typecheck`                                       | exit 0 — pass       |
| `pnpm -r build`                                           | exit 0 — pass       |
| `pnpm -r test` (whole monorepo)                           | exit 0 — pass       |
| `pnpm lint` (whole monorepo)                              | exit 0 — pass       |

## 4. Schema review

### 4.1 Indexable column inventory

Every business model has at least one explicit index suitable for the queries it will support:

| Model        | Explicit indexes                                                  | Justification                                                            |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Company`    | `@@index([deletedAt])`, `@@unique` on `ruc`                       | Filter out soft-deleted tenants; `ruc` is the natural tenant lookup key. |
| `User`       | `@@index([deletedAt])`, `@@unique` on `email`                     | Soft-delete query path; `email` is the login lookup key.                 |
| `Membership` | `@@index([companyId])`, `@@unique([userId, companyId])`           | List members of a tenant; enforce one role per (user, company) pair.     |
| `Session`    | `@@index([userId, expiresAt])`, `@@index([companyId])`            | Server-side session lookup + cleanup of expired rows per user.           |
| `AuditLog`   | `@@index([companyId, createdAt])`, `@@index([action, createdAt])` | Tenant-scoped audit timeline + cross-tenant action timeline.             |

### 4.2 Foreign keys

| Table        | Column      | References   | `onDelete` | Reasoning                                                                                                  |
| ------------ | ----------- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `Membership` | `userId`    | `User.id`    | `Restrict` | A user with active memberships must not be silently deleted.                                               |
| `Membership` | `companyId` | `Company.id` | `Restrict` | A tenant with active memberships must not be silently deleted.                                             |
| `Session`    | `userId`    | `User.id`    | `Restrict` | Sessions surface in security audits; require explicit cleanup before deleting their owner.                 |
| `Session`    | `companyId` | `Company.id` | `Restrict` | Same reasoning; the active tenant cannot be deleted while a session points at it.                          |
| `AuditLog`   | `companyId` | `Company.id` | `SetNull`  | Audit rows must outlive the tenant. After a tenant is purged, the audit trail stays with `companyId=NULL`. |

Deviation note: SPEC-0004 §6.2 used `Cascade` for `Membership` and `Session` FKs. PROMPT-0004 §3 (this slice) explicitly requires "default to `Restrict`" and "every FK declares an explicit `onDelete`". The implementation follows the prompt, which is the operative instruction. Switching to Cascade can be considered later, but it conflicts with the prompt's stated guard.

### 4.3 Multi-tenant invariant

- `Membership` is the **only** join between `User` and `Company` (AC-6 satisfied).
- Every tenant-scoped table in this slice (`AuditLog`, `Session`) carries `companyId` (nullable for system-level events / not-yet-selected tenant, by design — see SPEC-0004 §6.2 and ADR-0004).
- Future business-domain tables (Certificate, Invoice, Customer, EmissionPoint, …) will add non-null `companyId` per SPEC-0004 §7.3 — explicitly out of scope for this slice.

## 5. Deviations from spec / plan

1. **Workspace layout.** SPEC-0004 §6.1 placed the schema under `apps/api/prisma/`. PLAN-0004 §3 promotes it to a single `prisma/schema.prisma` at the repo root, and TASKS-0004 §1.3 introduces `packages/db` as a shared workspace. The user's finishing-line validation commands (`pnpm --filter @facturador/db prisma:migrate`, `pnpm --filter @facturador/db seed`, `pnpm --filter @facturador/db test`) make the package boundary explicit. Implementation puts the schema under `packages/db/prisma/schema.prisma` and the seed under `packages/db/prisma/seed.ts`. This is consistent with PLAN-0004 ("one Prisma schema at the repo root") in spirit and with the prompt's exact command surface in fact. Documented as a deliberate consolidation rather than a slip.

2. **`DATABASE_URL` is now host-relative by default.** `.env`/`.env.example` carries `postgresql://...@localhost:5432/...` so host-side tooling (Prisma CLI, Vitest) reaches the published port without extra knobs. SPEC-0003 §6.2 originally used `db:5432`. The container-internal value is restored explicitly via `services.api.environment.DATABASE_URL` and `services.sri-core.environment.DATABASE_URL` in `docker-compose.yml`, so in-network resolution still works. Net result: both host and container paths are correct; no developer needs to maintain two env files.

3. **`onDelete: Restrict` instead of `Cascade` on `Membership`/`Session`.** Per PROMPT-0004 §3 hard constraint ("default to `Restrict`"). SPEC-0004 §6.2 example used `Cascade`. Followed the prompt.

4. **`dotenv-cli` wrapper** added on `@facturador/db` (devDep) and `@facturador/api` (devDep). Prisma's CLI looks for `.env` next to the schema (or in `cwd`); the repo's authoritative `.env` lives at the root. Rather than copy the file or symlink it (Windows-hostile), all scripts that need DB env are wrapped with `dotenv -e ../../.env --`. This is the lightest possible bridge.

5. **No `apps/sri-core` wiring of `@facturador/db` in this slice.** The prompt restricts scope to data layer + seed + smoke tests; `apps/sri-core` will pick up the shared client when SPEC-0020 lands. The shared package is ready (`PrismaClient` is exported).

6. **`tsconfig.build.json` split.** `packages/db/tsconfig.json` now covers the full surface for typecheck + ESLint (`src/**/*`, `prisma/**/*.ts`, `test/**/*.ts`) with `noEmit: true`. `tsconfig.build.json` is the compile target (`src/**/*` → `dist/`). Required because `prisma/seed.ts` and `test/**/*.ts` need TypeScript-aware lint/type-check but must not land in `dist`.

## 6. Risks observed

| Risk                                                                                                          | Mitigation                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email case-insensitivity** depends on the application normalizing to lowercase before insert (no `citext`). | Seed normalises with `email.trim().toLowerCase()`; future code paths (login, signup) must follow the same convention. SPEC-0010 owns the runtime enforcement. |
| **Dev placeholder password `Admin123!`** ships in `prisma/src/env.ts`.                                        | The default is documented as dev-only; CI / staging / prod must supply `SEED_ADMIN_PASSWORD`. Highlighted again in §7 below.                                  |
| **No Row-Level Security yet.** Tenant isolation is enforced only in app code today.                           | Captured in SPEC-0004 §6.6 and §12 as a follow-up; RLS lands in its own spec before going to production.                                                      |
| **Connection pooling is unconfigured.** Default Prisma pool of 10 connections is fine for dev only.           | Document `connection_limit` / pgbouncer once the production deploy spec exists. SPEC-0004 §5 NFR-1.                                                           |
| **No tenancy-aware ESLint rule yet.** Mis-scoped queries against future tenant tables are not caught.         | SPEC-0007 owns the custom ESLint rule (AC-6 there). Until then, code review is the line of defence.                                                           |
| **Prettier still reports drift on two pre-existing review files.**                                            | Not introduced by this slice; `pnpm format:check` failures are unrelated to PROMPT-0004 deliverables. Will need a follow-up format pass.                      |
| **`Membership.onDelete = Restrict`** means deleting a tenant or user from SQL requires explicit teardown.     | Intentional safety net; can be re-evaluated if soft-delete plus periodic purge replaces hard delete in a later spec.                                          |

## 7. Security review

| Control                                                                                       | Status                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **argon2id parameters** — `{ memoryCost: 65_536, timeCost: 3, parallelism: 1 }` (OWASP 2024). | Confirmed. `packages/db/prisma/seed.ts:24` declares `ARGON2_PARAMS`. The CRUD smoke test additionally exercises the same params at runtime; the verification test reads back the seeded hash with `argon2.verify`.                                                                                                                 |
| **No plaintext password column.**                                                             | Confirmed. The schema declares `passwordHash`; no `password` column appears anywhere in `packages/db/prisma/schema.prisma` or the migration SQL.                                                                                                                                                                                   |
| **Seed never logs or persists plaintext password.**                                           | Confirmed. The seed reads `adminPassword` from env, passes it directly into `argon2.hash`, and never echoes the value. The single stdout line prints only `company=<ULID> user=<ULID>`. The default `Admin123!` lives in `src/env.ts` as a sentinel — flagged as non-production in the file's doc comment and in this review (§6). |
| **`Session.id` is a ULID** (`@db.Char(26)`).                                                  | Confirmed. The schema declares `id String @id @db.Char(26)`. Session creation in later specs (SPEC-0010) will generate the ULID app-side via `newId()` from `@facturador/db`.                                                                                                                                                      |
| **`email` is unique + lowercased before insert.**                                             | Confirmed at schema level (`@unique` on `User.email`) and at app level (`normaliseEmail` in `prisma/seed.ts`). DB-level `citext` was not adopted (PostgreSQL extension availability is environment-dependent). The convention is enforced in code.                                                                                 |
| **`/health-db` does not leak DSN or DB internals.**                                           | Confirmed. The handler catches _any_ error from `prisma.$queryRaw` and returns a fixed `{ db: "down" }` body with status 503. The catch block deliberately does not include `err.message` in the response (matches `ai/context/security.md` §"Do not log").                                                                        |
| **Prisma log level**                                                                          | `["warn", "error"]` by default. Never `query` — matches SPEC-0004 §10 and `ai/context/security.md`. Tests may pass a different level explicitly via `createPrismaClient([...])`.                                                                                                                                                   |
| **`AuditLog.payloadJson` is `Json?`** and untyped.                                            | Documented as a writer responsibility: any future code path that writes audit rows MUST redact PII, certificate bytes, signing material, and SRI tokens before insert. The schema comment in `schema.prisma` says so verbatim; SPEC-0006 will own the logger redaction list that the audit writers should reuse.                   |
| **Secrets in source.**                                                                        | The dev seed password placeholder is `Admin123!`. Not a commit-time secret (no real account uses it); explicitly flagged for override in any non-dev environment.                                                                                                                                                                  |

## 8. Suggested follow-ups

1. **Row-Level Security (RLS).** Add a dedicated SPEC to enable Postgres RLS on every tenant-scoped table before production. Strategy: `USING (companyId = current_setting('app.current_company', true))` plus a per-request `SET LOCAL app.current_company = ...` from the API tenant guard.
2. **pgbouncer / connection pooling.** Document `connection_limit` and (eventually) deploy a pooler when the production hosting story exists. SPEC-0004 NFR-1 placeholder.
3. **Custom ESLint rule** for tenant scoping. Land in SPEC-0007 (AC-6): warn on any `prisma.<tenantModel>.{findMany,findFirst,...}` whose `where` clause omits `companyId`.
4. **Zod-validated env for `@facturador/db`.** Currently a tiny env loader; once SPEC-0006 lands, swap it for a Zod schema so missing/invalid env fails fast at seed and runtime.
5. **Soft-delete query helpers.** Each future tenant repository should filter `deletedAt: null` by default; add a thin helper to avoid repetition.
6. **CI smoke for `prisma migrate deploy`.** Add a workflow that spins up Postgres, runs `migrate deploy`, runs the seed, and runs the CRUD smoke against a throwaway schema — exercising the production migration path.
7. **`apps/sri-core` ↔ `@facturador/db` wiring.** Will be picked up in SPEC-0020 (SRI Core bootstrap).
8. **Prettier sweep.** Two pre-existing review files (`ai/reviews/0002-shared-tooling-review.md`, `ai/reviews/0003-docker-and-local-dev-review.md`) drift from Prettier; out of scope here, suggest a one-shot `pnpm format` PR.

## 9. Sign-off checklist (SPEC-0004 AC-1…AC-7)

- ✅ **AC-1.** `prisma migrate dev` produced `prisma/migrations/20260521011640_init/migration.sql` covering all 5 baseline tables + `Role` enum + every required index. `prisma validate` exits 0.
- ✅ **AC-2.** `prisma generate` produces a type-safe `@prisma/client`. `packages/db/src/index.ts` consumes `PrismaClient` directly with no `any`; downstream `apps/api/src/server.ts` and `apps/api/src/health-db.test.ts` import the typed client and pass `pnpm -r typecheck`.
- ✅ **AC-3.** `db:seed` is idempotent — verified by row counts before/after a second run (1/1/1 in both cases) and identical row IDs.
- ⏭️ **AC-4.** Login flow for `admin@facturador.test`/`Admin123!` is exercised end-to-end in SPEC-0010 (cross-reference noted in that spec). What this slice does prove: `argon2.verify(seededHash, "Admin123!") === true` and `argon2.verify(seededHash, "wrong-password") === false`. The user is intentionally `admin@facturador.test` rather than SPEC-0004 §6.8's `admin@demo.local` to match TASKS-0004 §4.1.
- ✅ **AC-5.** `GET /health-db` returns `200 {"db":"ok"}` against the seeded dev DB (curl + Vitest evidence above).
- ✅ **AC-6.** `Membership` is the only join between `User` and `Company` (no other relation column on either model). Future tenant-scoped tables will inherit this rule per `ai/context/security.md`.
- ✅ **AC-7.** No `prisma db push` anywhere in source. Every schema mutation is via `prisma migrate dev` (local) or `prisma migrate deploy` (CI). `pnpm --filter @facturador/db prisma:migrate:deploy` script is wired and ready.

End of review.
