---
id: SPEC-0004
title: Database & Prisma baseline
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0003]
blocks: [SPEC-0010, SPEC-0011, SPEC-0021, SPEC-0026, SPEC-0030, SPEC-0031, SPEC-0032]
---

# SPEC-0004 — Database & Prisma baseline

## 1. Purpose

Establish Prisma ORM as the data layer, define the **multi-tenant base schema** every subsequent domain spec extends, and lock the migration workflow. Multi-tenant isolation is enforced at the application layer (every query filters by `companyId`) and reinforced by Postgres row-level security where feasible.

## 2. Scope

### 2.1 In scope

- Single Prisma schema located in `apps/api/prisma/schema.prisma`.
- Connection pooling configuration.
- Migrations workflow (dev `migrate dev`, prod `migrate deploy`).
- Base tables: `User`, `Session`, `Company` (tenant), `Membership`, `AuditLog`.
- Soft-delete + timestamps convention.
- ULID primary keys (string) for human-readable IDs; database uses `text` columns with check constraints.
- Seed script with one demo tenant + admin user for local dev.
- Row-level security baseline for tenant-scoped tables (advisory; enforced primarily in app code).
- Repository pattern guidance (no DAO frameworks; thin functions over `prisma.<model>`).

### 2.2 Out of scope

- Domain-specific tables for `Customer`, `Invoice`, `EmissionPoint`, etc. — added by their own specs but **must** follow conventions herein.
- Read replicas, sharding.
- Backups & point-in-time recovery (deployment spec, later).

## 3. Context & references

- [SPEC-0001](./0001-monorepo-and-workspace.md) — workspace layout.
- [SPEC-0003](./0003-docker-and-local-dev.md) — Postgres container.
- [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) — session table specifics.
- [`ai/context/security.md`](../context/security.md) — multi-tenant isolation requirements (every query filters by `companyId`).
- Prisma docs: https://www.prisma.io/docs

## 4. Functional requirements

- **FR-1.** Prisma schema is the single source of truth; migrations are committed to git.
- **FR-2.** A single `PrismaClient` instance per Node process, exported from `apps/api/src/db/client.ts`.
- **FR-3.** All tenant-scoped tables include `companyId text not null` with FK to `companies.id`, and a composite index `(companyId, createdAt desc)`.
- **FR-4.** All tables have `id text primary key` (ULID), `createdAt timestamptz not null default now()`, `updatedAt timestamptz not null default now()` (Prisma `@updatedAt`), and `deletedAt timestamptz null` for soft delete where appropriate.
- **FR-5.** `prisma migrate dev` runs against the local docker DB; `prisma migrate deploy` runs in CI/prod.
- **FR-6.** A `prisma db seed` command sets up a deterministic local tenant + admin user for the demo.
- **FR-7.** A request-scoped tenant guard ([SPEC-0011](./0011-tenants-memberships-rbac.md)) injects `companyId` and **all repositories must accept it explicitly** — no implicit "current tenant" from globals.
- **FR-8.** Audit log table captures sensitive events (login, certificate upload, document state change). See [SPEC-0006](./0006-error-model-and-logging.md).

## 5. Non-functional requirements

- **NFR-1.** Prisma connection pool defaults: `connection_limit=10` for API in dev, configurable via `DATABASE_URL` query.
- **NFR-2.** Median query time under load (auth lookup + tenant load) ≤ 5 ms locally.
- **NFR-3.** Migrations apply in ≤ 30 s on an empty database.
- **NFR-4.** Schema diffing CI step (later spec) catches drift between schema and migrations.

## 6. Technical design

### 6.1 Layout

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                  # generated
│   └── seed.ts                      # idempotent seed for local dev
└── src/
    └── db/
        ├── client.ts                # singleton PrismaClient
        ├── repositories/            # thin tenant-aware repos (per domain spec)
        └── ulid.ts                  # ULID helper
```

### 6.2 `schema.prisma` (baseline)

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// Identity & tenancy
// ============================================================

model Company {
  id                   String       @id // ULID
  ruc                  String       @unique // 13-digit Ecuadorian RUC
  razonSocial          String
  nombreComercial      String?
  ambiente             String       // '1' pruebas | '2' produccion
  obligadoContabilidad Boolean      @default(false)
  contribuyenteEspecial String?     // resolution code if any
  dirMatriz            String
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt
  deletedAt            DateTime?

  memberships          Membership[]
  emissionPoints       EmissionPoint[]
  certificates         Certificate[]
  customers            Customer[]
  invoices             Invoice[]
  auditLogs            AuditLog[]

  @@index([deletedAt])
  @@map("companies")
}

model User {
  id           String       @id // ULID
  email        String       @unique
  passwordHash String
  fullName     String
  isActive     Boolean      @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  deletedAt    DateTime?

  memberships  Membership[]
  sessions     Session[]

  @@index([deletedAt])
  @@map("users")
}

model Membership {
  id              String   @id // ULID
  userId          String
  companyId       String
  role            Role     // OWNER | ADMIN | ACCOUNTANT | OPERATOR | VIEWER
  invitedAt       DateTime @default(now())
  acceptedAt      DateTime?
  revokedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  company         Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([userId, companyId])
  @@index([companyId])
  @@map("memberships")
}

enum Role {
  OWNER
  ADMIN
  ACCOUNTANT
  OPERATOR
  VIEWER
}

model Session {
  id              String   @id // opaque ULID (cookie value)
  userId          String
  activeCompanyId String?  // null = no tenant selected yet
  userAgent       String?
  ipHash          String?  // SHA-256 of client IP; never log raw IP
  csrfSecret      String   // random base64; rotated on tenant switch
  createdAt       DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  expiresAt       DateTime
  revokedAt       DateTime?

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@index([revokedAt])
  @@map("sessions")
}

// ============================================================
// Audit log
// ============================================================

model AuditLog {
  id          String   @id // ULID
  companyId   String?  // null for system-level events (login attempts, etc.)
  actorUserId String?
  action      String   // e.g. "auth.login.success", "invoice.emit.sent"
  resource    String?  // e.g. "invoice:01J..."
  metadata    Json     // structured, redact-safe data (no PII payloads)
  createdAt   DateTime @default(now())
  ipHash      String?

  company     Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)

  @@index([companyId, createdAt])
  @@index([action, createdAt])
  @@map("audit_logs")
}
```

> Future specs add models (`Certificate`, `EmissionPoint`, `Customer`, `Invoice`, `SriEvent`, …) into the same file. They **must** keep ULID PKs, timestamps, and `companyId` foreign keys when tenant-scoped.

### 6.3 ULID strategy

- Use [`ulid`](https://www.npmjs.com/package/ulid) (npm) — lexicographically sortable, 26 chars, no PII.
- `apps/api/src/db/ulid.ts`:

```ts
import { ulid } from "ulid";
export const newId = (): string => ulid();
```

- Prisma `@id` is `String`, generated **in application code** (not by the DB). Repositories always assign `id: newId()` on create.

### 6.4 Prisma client singleton

```ts
// apps/api/src/db/client.ts
import { PrismaClient } from "@prisma/client";
import { env } from "../env.js";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma__ ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}
```

(Pattern needed because `dev` watchers reload modules and would otherwise leak connections.)

### 6.5 Tenant-aware repository pattern

No DAO framework. A repo is a folder under `apps/api/src/db/repositories/<aggregate>/`:

```ts
// apps/api/src/db/repositories/companies/find-by-id.ts
import { prisma } from "../../client.js";
export const findCompanyById = (id: string) =>
  prisma.company.findFirst({ where: { id, deletedAt: null } });
```

For tenant-scoped queries:

```ts
// apps/api/src/db/repositories/invoices/list-for-tenant.ts
import { prisma } from "../../client.js";

export const listInvoicesForTenant = (companyId: string, limit = 50) =>
  prisma.invoice.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
```

**Rule:** Repository functions accept `companyId` explicitly. Linting will flag any repo file that touches `prisma.<tenantModel>` without filtering by `companyId` (custom ESLint rule added in [SPEC-0007](./0007-testing-strategy.md), follow-up).

### 6.6 Row-level security (defense in depth, optional initially)

Postgres RLS adds belt-and-suspenders protection. Initial implementation:

- Enable RLS on every tenant-scoped table.
- Policy: `USING (companyId = current_setting('app.current_company', true))`.
- The app sets `SET LOCAL app.current_company = '<companyId>'` at the start of each transaction.

This is **optional for the initial milestone**. If skipped, a follow-up spec must add it before going to production.

### 6.7 Migrations workflow

| Command                                           | When                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm --filter @facturador/api db:migrate:dev`    | Local development; prompts for migration name. Generates SQL + applies. |
| `pnpm --filter @facturador/api db:migrate:deploy` | CI/staging/prod — apply pending migrations without prompts.             |
| `pnpm --filter @facturador/api db:migrate:reset`  | Local only — drops and re-creates DB; runs seed.                        |
| `pnpm --filter @facturador/api db:seed`           | Idempotent local seed (see §6.8).                                       |

Underlying scripts in `apps/api/package.json`:

```jsonc
{
  "scripts": {
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:migrate:reset": "prisma migrate reset --force",
    "db:seed": "tsx prisma/seed.ts",
    "prisma:generate": "prisma generate",
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts",
  },
}
```

### 6.8 Seed script (`apps/api/prisma/seed.ts`)

Deterministic. Idempotent. Creates:

- Company `Demo S.A.` with RUC `1790012345001`, `ambiente=1`.
- User `admin@demo.local` with password `Demo!123` (argon2id hash).
- Membership `OWNER`.
- One `EmissionPoint` `001-001`.

```ts
import { PrismaClient, Role } from "@prisma/client";
import { ulid } from "ulid";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const companyId = "01J0DEMOCOMPANYULIDDEMO";
  const userId = "01J0DEMOUSERULIDDEMO000";

  await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: {
      id: companyId,
      ruc: "1790012345001",
      razonSocial: "DEMO S.A.",
      nombreComercial: "Demo",
      ambiente: "1",
      obligadoContabilidad: true,
      dirMatriz: "Av. Demo 123",
    },
  });

  const passwordHash = await argon2.hash("Demo!123", { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: "admin@demo.local",
      passwordHash,
      fullName: "Admin Demo",
    },
  });

  await prisma.membership.upsert({
    where: { userId_companyId: { userId, companyId } },
    update: {},
    create: { id: ulid(), userId, companyId, role: Role.OWNER, acceptedAt: new Date() },
  });
}

main().finally(() => prisma.$disconnect());
```

## 7. Implementation guide

### 7.1 Steps

1. Add `prisma`, `@prisma/client`, `tsx`, `ulid`, `argon2` to `apps/api`.
2. Add `apps/api/prisma/schema.prisma` from §6.2.
3. Add `apps/api/src/db/client.ts`, `ulid.ts` from §6.3–6.4.
4. Add seed script `apps/api/prisma/seed.ts` from §6.8.
5. Wire scripts into `apps/api/package.json` per §6.7.
6. `pnpm --filter @facturador/api exec prisma generate`.
7. With docker DB up: `pnpm --filter @facturador/api db:migrate:dev --name init`.
8. `pnpm --filter @facturador/api db:seed`.
9. Verify with `pnpm db:psql -c 'select * from companies'` (should show the demo row).

### 7.2 Dependencies to install (apps/api)

| Package          | Version   | Purpose                                             |
| ---------------- | --------- | --------------------------------------------------- |
| `prisma`         | `^5.20.0` | CLI / generator (devDependency).                    |
| `@prisma/client` | `^5.20.0` | Runtime.                                            |
| `tsx`            | `^4.19.0` | Run TS seed script.                                 |
| `ulid`           | `^2.3.0`  | PK generator.                                       |
| `argon2`         | `^0.41.0` | Password hashing (needed by seed and by SPEC-0010). |

### 7.3 Conventions for future schema additions

- **Every new model** must include: `id String @id`, `createdAt`, `updatedAt`, and (if tenant-scoped) `companyId`.
- **Every new tenant-scoped model** must include an index on `(companyId, createdAt(desc))` and a FK to `Company` with `onDelete: Cascade` unless the spec explicitly chooses `Restrict`.
- **No raw SQL** in app code except in migrations and an explicit `apps/api/src/db/raw/` folder reviewed for SQL injection.
- **No `prisma.$queryRawUnsafe`** anywhere.
- **No global mutable singletons** other than the Prisma client (§6.4).
- **Soft delete:** prefer `deletedAt` over hard deletes. Repositories must filter `deletedAt: null` by default.

## 8. Acceptance criteria

- **AC-1.** `prisma migrate dev` produces a migration file `prisma/migrations/<ts>_init/migration.sql` covering all 5 baseline tables + enum + indexes.
- **AC-2.** `prisma generate` produces a type-safe `@prisma/client` consumed by `apps/api/src/db/client.ts` with no `any`.
- **AC-3.** `db:seed` is idempotent (running twice does not duplicate rows; rerun yields zero new rows).
- **AC-4.** Login attempt for `admin@demo.local` with `Demo!123` succeeds once [SPEC-0010](./0010-authentication-and-sessions.md) is implemented (cross-reference verified during that spec).
- **AC-5.** `prisma.user.findFirst()` query in `apps/api/src/db/client.ts` returns the demo row.
- **AC-6.** ESLint rule (added in [SPEC-0007](./0007-testing-strategy.md)) catches a `prisma.invoice.findMany({ where: {} })` lacking `companyId` filter once the `Invoice` model is added.
- **AC-7.** `prisma migrate reset --force` rebuilds the schema cleanly with seed applied.

## 9. Test plan

- Unit: `ulid.ts` produces strings of length 26 matching `^[0-9A-HJKMNP-TV-Z]+$`.
- Integration (Vitest with a throwaway DB schema):
  - Connect, create company, create user, create membership, fetch back.
  - Soft-delete a company → repository functions exclude it.
- Migration test: run `migrate reset` and verify seed data matches expected fingerprint (deterministic IDs).

## 10. Security considerations

- **Tenant isolation** lives in app code. Reviewer is responsible for verifying every new repo function filters by `companyId`.
- **No raw SQL** with user-controlled strings.
- **Passwords:** argon2id with default params from the lib. [SPEC-0010](./0010-authentication-and-sessions.md) pins the parameter set after benchmarking.
- **IP hashing:** `Session.ipHash` and `AuditLog.ipHash` store `sha256(ip + dailySalt)` — never the raw IP. Salt rotates daily.
- **Audit log** is append-only; no soft-delete, no update endpoint.
- **Prisma logs** default to `warn`/`error`; never `query` in production (leaks parameters).

## 11. Observability

- Migration runs emit logs to stdout.
- Prisma query duration metrics piped to logger (instrumentation in a later spec).
- Audit log is queryable but **not** the primary observability channel — use it for compliance, not debugging.

## 12. Risks and mitigations

| Risk                                  | Mitigation                                                          |
| ------------------------------------- | ------------------------------------------------------------------- |
| Forgotten tenant filter leaks data    | Custom ESLint rule + code review + (eventually) RLS.                |
| Schema drift across environments      | `migrate deploy` only in CI; never `migrate dev` in production.     |
| ULID collisions across services       | Generated per process; collision probability negligible.            |
| Long-running migrations block deploys | Each migration kept narrow; data backfills run as separate scripts. |

## 13. Open questions

- RLS: enable in this spec or as a follow-up? Default: follow-up to keep this spec focused; reviewer can opt to include it now.
- Sessions in Postgres vs Redis? Postgres for now (per ADR-0004). Revisit only if traffic warrants.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
