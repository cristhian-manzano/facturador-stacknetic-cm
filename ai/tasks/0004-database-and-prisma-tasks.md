---
id: TASKS-0004
spec: SPEC-0004
plan: PLAN-0004
title: Database & Prisma baseline — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0004 — Database & Prisma baseline

> Checklist for [SPEC-0004](../specs/0004-database-and-prisma.md) + [PLAN-0004](../plans/0004-database-and-prisma-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never write a password in plaintext to any seed / fixture file. Use argon2id; the unhashed value is supplied via env at seed time.
- ❌ Never use `prisma db push` in committed scripts (production-incompatible).
- ❌ Never delete or rewrite an existing migration once committed; create a new one instead.
- ✅ Every model has an explicit `@@index` where queries are expected (no implicit reliance).
- ✅ Idempotency is a hard requirement: running `pnpm prisma db seed` twice must produce identical row counts.

## 1. Prisma installation & scaffolding

- [ ] **1.1** At repo root: add devDep `prisma@^5`, dep `@prisma/client@^5`, dep `ulid@^2`, dep `argon2@^0.31`, devDep `tsx`.
      **Validate**: `pnpm prisma --version` prints v5; `pnpm exec node -e "import('argon2').then(m=>console.log(typeof m.hash))"` prints `function`.

- [ ] **1.2** Create `prisma/schema.prisma` with datasource + generator headers (see PLAN §4 Phase 1).
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **1.3** Create `packages/db/` workspace with `package.json` (name `@facturador/db`, type module, exports `./src/index.ts` or built `./dist/index.js`), `tsconfig.json` extending base, and `src/index.ts`:

  ```ts
  import { PrismaClient } from "@prisma/client";
  export const prisma = new PrismaClient({ log: ["warn", "error"] });
  ```

  **Validate**: `pnpm --filter @facturador/db typecheck` exits 0.

- [ ] **1.4** Register `packages/db` in `pnpm-workspace.yaml` (already covered by `packages/*` glob).
      **Validate**: `pnpm list --filter @facturador/db` prints the package.

## 2. Schema models

- [ ] **2.1** Define `enum Role { OWNER ADMIN ACCOUNTANT OPERATOR VIEWER }`.
      **Validate**: `pnpm prisma validate` exits 0 after adding.

- [ ] **2.2** Define `model Company` with fields: `id String @id @db.Char(26)`, `ruc String @unique`, `razonSocial String`, `nombreComercial String?`, `ambiente String`, `tipoEmision String`, `direccionMatriz String`, `contribuyenteEspecial String?`, `obligadoContabilidad Boolean`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `deletedAt DateTime?`.
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **2.3** Define `model User` with: `id @id @db.Char(26)`, `email String @unique`, `passwordHash String`, `displayName String`, `locale String @default("es-EC")`, `isSuperadmin Boolean @default(false)`, timestamps, `deletedAt DateTime?`.
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **2.4** Define `model Membership` with: `id`, `userId`, `companyId`, `role Role`, timestamps, FKs `user @relation(...)`, `company @relation(...)`, `onDelete: Restrict`, `@@unique([userId, companyId])`, `@@index([companyId])`.
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **2.5** Define `model Session` with: `id @id @db.Char(26)`, `userId`, `companyId String?`, `csrfTokenHash String`, `createdAt`, `expiresAt DateTime`, `lastSeenAt DateTime`, `ip String?`, `userAgent String?`, FKs and `@@index([userId, expiresAt])`.
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **2.6** Define `model AuditLog` with: `id`, `companyId String?`, `actorUserId String?`, `action String`, `entity String`, `entityId String?`, `ip String?`, `userAgent String?`, `payloadJson Json?`, `createdAt`, `@@index([companyId, createdAt])`.
      **Validate**: `pnpm prisma validate` exits 0.

## 3. Migration

- [ ] **3.1** Ensure Postgres is running: `docker compose up -d db`.
      **Validate**: `docker compose exec db pg_isready -U facturador` returns "accepting connections".

- [ ] **3.2** From repo root, with `.env` present: `pnpm prisma migrate dev --name init`.
      **Validate**: exit 0; new directory `prisma/migrations/<timestamp>_init/` contains a `migration.sql` file with `CREATE TABLE "Company"` etc.

- [ ] **3.3** `pnpm prisma migrate status` reports "in sync".
      **Validate**: exit 0.

## 4. Seed

- [ ] **4.1** Create `prisma/seed.ts` that:

  - Reads `SEED_ADMIN_EMAIL` (default `admin@facturador.test`), `SEED_ADMIN_PASSWORD` (default `Admin123!`).
  - Upserts a Company with `ruc=9999999999001` (synthetic test RUC).
  - Hashes the password with argon2id (`type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1`).
  - Upserts the admin User.
  - Upserts a Membership linking the user to the company with `role: OWNER`.
  - Logs a single summary line "Seed complete: company=<id> user=<id>".
  - Uses ULIDs for new rows.
    **Validate**: `pnpm prisma db seed` exits 0 and prints the summary line.

- [ ] **4.2** Run seed a second time without manual cleanup.
      **Validate**: exit 0; `psql -c "SELECT count(*) FROM \"User\";"` returns the same count as after the first run (1).

- [ ] **4.3** Configure `package.json` at root:
  ```json
  "prisma": { "seed": "tsx prisma/seed.ts" }
  ```
  **Validate**: `pnpm prisma db seed` (no args) still works.

## 5. App wiring & DB health endpoint

- [ ] **5.1** In `apps/api`, add dep `@facturador/db` and `@facturador/contracts` (placeholder).
      **Validate**: `pnpm install` exits 0; `apps/api/node_modules/@facturador/db` symlink exists.

- [ ] **5.2** Add `GET /health-db` to `apps/api/src/server.ts` that runs `await prisma.$queryRaw\`SELECT 1\``and returns`{ db: "ok" }`on success, 503 on failure.
**Validate**: integration test`apps/api/src/health-db.test.ts`boots the app with a real Prisma client pointing at a Postgres test schema, asserts 200 +`{"db":"ok"}`. `pnpm --filter @facturador/api test` exits 0.

- [ ] **5.3** Compose smoke: `docker compose up -d db api && curl -fsS localhost:3000/health-db` → 200.
      **Validate**: HTTP 200; body contains `"db":"ok"`.

## 6. Argon2 verification

- [ ] **6.1** Add a unit test `prisma/seed.test.ts` (or in `apps/api`) that:
  - Imports argon2 and verifies the seeded admin's hash matches `Admin123!`.
  - Verifies an incorrect password returns false.
    **Validate**: `pnpm test` exits 0; the test passes.

## 7. Acceptance criteria

- [ ] AC-1: Prisma schema validates.
- [ ] AC-2: `prisma migrate dev --name init` creates an initial migration.
- [ ] AC-3: `prisma db seed` is idempotent.
- [ ] AC-4: Admin user password is hashed with argon2id (never stored plaintext).
- [ ] AC-5: `/health-db` returns 200 from the API.
- [ ] AC-6: Multi-tenant isolation: `Membership` is the only join between `User` and `Company`.
- [ ] AC-7: No `db push` references anywhere; production-ready migration workflow only.

## 8. Definition of Done

- All tasks ticked, seed idempotent, integration test green.
- `pnpm prisma migrate deploy` works against a fresh DB from scratch.
- Review file `ai/reviews/0004-database-and-prisma-review.md` written.
