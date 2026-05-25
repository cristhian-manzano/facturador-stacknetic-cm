---
id: PLAN-0004
spec: SPEC-0004
title: Database & Prisma baseline — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0004 — Database & Prisma baseline

> Implementation plan for [SPEC-0004](../specs/0004-database-and-prisma.md). Depends on [PLAN-0001](./0001-monorepo-and-workspace-plan.md), [PLAN-0003](./0003-docker-and-local-dev-plan.md).

## 1. Goal

Establish the Prisma 5 baseline: schema for shared identity tables (`Company`, `User`, `Membership`, `Session`, `AuditLog`), idempotent seed, per-environment client factory, and migration workflow. After this slice:

- `pnpm prisma migrate dev` creates tables.
- `pnpm prisma db seed` inserts deterministic dev data idempotently.
- `apps/api` and `apps/sri-core` each have a typed Prisma client they share via `packages/db` (or, if simpler per spec, each app generates its own client from the same schema).
- A round-trip integration test (Vitest + Supertest hitting `/health-db`) reads the seeded `Company` and returns it.

## 2. Inputs

- [SPEC-0004](../specs/0004-database-and-prisma.md) — authoritative.
- [ai/context/security.md](../context/security.md) — argon2id, no plaintext passwords, ULIDs.
- [ai/decisions/ADR-0004-auth-session-strategy.md](../decisions/ADR-0004-auth-session-strategy.md) — sessions are server-side rows.

## 3. Architecture decisions

| Decision                                                                                                                                         | Rationale                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **ULID** primary keys (`@id @default(cuid())` is acceptable if `ulid()` not native; use `@db.Char(26)` with app-side generation).                | Sortable, URL-safe, no collisions.                                                                             |
| Schema lives in **one** `prisma/schema.prisma` at the repo root (or per-app — SPEC dictates one root).                                           | Single source of truth across api + sri-core; both apps consume the generated client from the shared location. |
| Migrations stored in `prisma/migrations/` at repo root.                                                                                          | Reviewable via Git.                                                                                            |
| Password hashes use **argon2id** (`memoryCost: 64 * 1024`, `timeCost: 3`, `parallelism: 1`).                                                     | Modern OWASP recommendation; bcrypt only as fallback.                                                          |
| Multi-tenant invariant: every business-domain row has a non-null `companyId` FK. Identity tables (`User`, `Session`) link via `Membership` join. | Enforce tenant isolation at the DB level.                                                                      |
| Soft delete via `deletedAt: DateTime?` only where business rules require auditability; do **not** soft-delete `Session` (delete row on logout).  | Avoid soft-delete sprawl.                                                                                      |
| Connection pooling: `pgbouncer`-friendly settings (`connection_limit`) documented in `.env.example`.                                             | Forward compatibility.                                                                                         |
| `prisma generate` runs in postinstall for affected packages.                                                                                     | Developers don't forget.                                                                                       |

## 4. Phases

### Phase 1 — Prisma scaffolding

1. Add devDependency `prisma`, runtime dep `@prisma/client` at root.
2. Create `prisma/schema.prisma` with `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` and `generator client { provider = "prisma-client-js", previewFeatures = [] }`.
3. Add models (initial set):
   - `Company { id, ruc, razonSocial, nombreComercial?, ambiente, tipoEmision, direccionMatriz, contribuyenteEspecial?, obligadoContabilidad, createdAt, updatedAt, deletedAt? }`.
   - `User { id, email @unique, passwordHash, displayName, locale, isSuperadmin, createdAt, updatedAt, deletedAt? }`.
   - `Membership { id, userId, companyId, role: Role, createdAt, updatedAt }` with composite unique `(userId, companyId)`.
   - `Session { id (ULID), userId, companyId?, csrfTokenHash, createdAt, expiresAt, lastSeenAt, ip?, userAgent? }`.
   - `AuditLog { id, companyId?, actorUserId?, action, entity, entityId?, ip?, userAgent?, payloadJson @db.JsonB?, createdAt }`.
   - Enum `Role { OWNER, ADMIN, ACCOUNTANT, OPERATOR, VIEWER }`.
4. Add unique indexes:
   - `User.email` unique (case-insensitive via `@db.Citext` or app-level normalization to lowercase before insert).
   - `Company.ruc` unique.
   - `Membership(userId, companyId)` unique.
5. Add foreign keys with `onDelete: Restrict` (no cascading deletes for identity).
6. Add multi-column indexes:
   - `AuditLog(companyId, createdAt)`.
   - `Session(userId, expiresAt)`.

### Phase 2 — Client factory

Create `packages/db/src/index.ts` exporting:

```ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient({ log: ["warn", "error"] });
```

With graceful shutdown hooks (`process.on("beforeExit",...)`).

`apps/api` and `apps/sri-core` import `prisma` from `@facturador/db` (NEW workspace package — register it in `pnpm-workspace.yaml`).

### Phase 3 — Migration

1. `pnpm prisma migrate dev --name init` from a clean DB (using compose Postgres).
2. Commit the generated migration files.
3. Verify `pnpm prisma migrate status` says "in sync".

### Phase 4 — Seed

Create `prisma/seed.ts`:

- Upserts a Company `RUC=9999999999001` (dev tenant).
- Upserts a User `admin@facturador.test` with argon2id hashed password (read from `SEED_ADMIN_PASSWORD` env or default `Admin123!`).
- Upserts a Membership linking user → company with role `OWNER`.

Add `prisma` config to root `package.json`:

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

Idempotency: use `upsert` keyed by unique fields; calling seed twice must not duplicate rows.

### Phase 5 — Integration smoke

Add `apps/api/src/health-db.test.ts` (or similar) that:

1. Spawns a per-test schema (per SPEC-0007 strategy; OK to inline a minimal version here).
2. Runs `prisma migrate deploy` against it.
3. Runs the seed.
4. Asserts that `prisma.company.findFirst()` returns the seed Company.

Add `GET /health-db` endpoint to `apps/api` that returns `{ db: "ok" }` after a `SELECT 1`. Supertest asserts 200.

## 5. Risks & mitigations

| Risk                                                 | Mitigation                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Two Prisma clients (api + sri-core) get out of sync. | Single schema at repo root; both apps import the same generated client.                |
| Seed crashes on second run.                          | Use upsert; tests assert idempotency.                                                  |
| Migration drift between dev and prod.                | `prisma migrate deploy` in CI; never `db push`.                                        |
| Passwords accidentally logged.                       | Schema column `passwordHash`; field name is added to logger REDACT_PATHS in SPEC-0006. |
| Citext extension unavailable.                        | Fall back to lowercase normalization at app layer.                                     |
| Native ULID not in Prisma.                           | Use Char(26) + app-side `ulid()` (devDependency `ulid`).                               |

## 6. Validation strategy

- `pnpm prisma validate` exits 0.
- `pnpm prisma migrate dev --create-only` produces a non-empty SQL file.
- `pnpm prisma migrate deploy` against a fresh DB succeeds.
- `pnpm prisma db seed` is idempotent (run twice; row counts identical).
- The integration test for `/health-db` passes.
- A unit test asserts `argon2.verify(hash, "Admin123!")` is true for the seeded user.

## 7. Exit criteria

- All SPEC-0004 acceptance criteria pass.
- A fresh checkout, after `pnpm install && cp .env.example .env && docker compose up -d db`, completes `pnpm prisma migrate deploy && pnpm prisma db seed` without manual intervention.

## 8. Out of scope

- Tenant-aware row-level security (RLS) policies — later spec.
- Sri Core's own models (Certificate, SriDocument, SriEvent) — SPEC-0020.
- Invoice / Customer models — SPECs 0030–0033.
