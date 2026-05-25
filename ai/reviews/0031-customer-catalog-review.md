---
id: REVIEW-0031
spec: SPEC-0031
plan: PLAN-0031
tasks: TASKS-0031
prompt: PROMPT-0031
title: Customer catalog — implementation review
status: complete
created: 2026-05-21
---

# REVIEW-0031 — Customer catalog

## 1. Summary

Built the tenant-scoped customer catalog per SPEC-0031 + PLAN-0031. A new
Prisma `Customer` model with a composite-unique
`(companyId, tipoIdentificacion, identificacion)` index, two helper indexes
(`(companyId, razonSocial)` and `(companyId, identificacion)`) and a
`(companyId, deletedAt)` index lives under `packages/db/prisma/schema.prisma`
and migrates as `20260521231322_billing_customers`. A new module
`apps/api/src/customers/` exposes:

- `validate.ts` — defence-in-depth Zod parse + per-branch rules. Per-branch
  validation factored into a single shared function for create/update.
- `ensure-consumidor-final.ts` — idempotent upsert helper used by SPEC-0033.
- `handlers.ts` + `routes.ts` — CRUD endpoints, search with prefix on
  razonSocial + exact match on identificacion, cursor pagination, RBAC
  gating, audit events, and the Consumidor Final idempotent endpoint.

All five `tipoIdentificacion` branches enforced (04 RUC, 05 Cédula, 06
Pasaporte, 07 Consumidor Final, 08 Exterior). Manual creation of the
`07` / `9999999999999` row is rejected with `customer.use_helper`; the
helper is the sole writer of that row per tenant. List responses exclude
PII columns (email, telefono, direccion); detail responses include them.
Audit `payloadJson` deliberately omits PII fields.

31 new integration tests pass, plus all 155 pre-existing tests (186/186
total green). Typecheck + build clean across all 9 workspaces.

## 2. Files created / changed

### Created

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/migrations/20260521231322_billing_customers/migration.sql`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/customers/validate.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/customers/ensure-consumidor-final.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/customers/handlers.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/customers/routes.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/customers/index.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/test/customers.test.ts`

### Modified

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/prisma/schema.prisma` — added `Customer` model with composite-unique + helper indexes.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/db/src/index.ts` — re-exported `Customer` Prisma row type.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/server.ts` — mounted `buildCustomerRouter` under `/api/v1`.

## 3. Validation evidence

### 3.1 Finishing-line validations

| Validation                                                                 | Status        | Notes                                                                                                                          |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @facturador/db prisma:validate`                             | PASS (exit 0) | Schema valid.                                                                                                                  |
| `pnpm --filter @facturador/db prisma migrate dev --name billing_customers` | PASS          | Migration created + applied.                                                                                                   |
| `pnpm --filter @facturador/db prisma:migrate:status`                       | PASS          | "Database schema is up to date!"                                                                                               |
| `pnpm --filter @facturador/api test test/customers.test.ts`                | PASS          | 31/31 tests green.                                                                                                             |
| `pnpm --filter @facturador/api test`                                       | PASS          | 186/186 tests across 18 files.                                                                                                 |
| `pnpm -r typecheck`                                                        | PASS (exit 0) | All 9 workspaces clean.                                                                                                        |
| `pnpm -r build`                                                            | PASS (exit 0) | All targets built.                                                                                                             |
| `pnpm --filter @facturador/api lint` (customers files)                     | PASS          | `eslint src/customers test/customers.test.ts` clean. (Pre-existing lint errors in other files are out of scope for SPEC-0031.) |

### 3.2 Test breakdown (customers.test.ts, 31 tests)

```
POST /api/v1/customers — per-branch validation
  ✓ [04 RUC] valid sociedad RUC + direccion → 201
  ✓ [04 RUC] invalid checksum → 400
  ✓ [04 RUC] missing direccion → 422 customer.direccion_required
  ✓ [05 Cédula] valid cédula + direccion → 201
  ✓ [05 Cédula] invalid checksum → 400
  ✓ [06 Pasaporte] valid alphanum + direccion → 201
  ✓ [06 Pasaporte] empty identification → 400
  ✓ [07 Consumidor Final] manual creation with canonical id → 409 use_helper
  ✓ [07 Consumidor Final] wrong literal identificacion → 400
  ✓ [08 Exterior] alphanumeric accepted; direccion optional → 201
  ✓ [08 Exterior] identification longer than 20 → 400
  ✓ body that injects companyId is ignored; row binds to req.companyId

POST /api/v1/customers — CRUD + RBAC
  ✓ OPERATOR creates a customer; row is persisted and audited
  ✓ VIEWER cannot create → 403 forbidden_action
  ✓ duplicate (tipoIdentificacion, identificacion) within tenant → 409 duplicate
  ✓ same identifier across different tenants is allowed

GET /api/v1/customers — list + search
  ✓ returns only active rows scoped to req.companyId; never PII in list
  ✓ search ?q=ACME prefix match on razonSocial (case-insensitive)
  ✓ search ?q=<identificacion> matches exactly on identificacion
  ✓ limit + cursor paginates stably

GET /api/v1/customers/:id
  ✓ returns 404 for cross-tenant id (no enumeration leak)
  ✓ detail response INCLUDES PII fields (deliberate, per SPEC §10)

PATCH /api/v1/customers/:id
  ✓ rejects attempts to change tipoIdentificacion → 422 immutable_field
  ✓ happy path updates razonSocial and audits the change (no PII in audit)

DELETE /api/v1/customers/:id
  ✓ ADMIN can soft-delete; subsequent list excludes the row
  ✓ OPERATOR cannot delete → 403

ensureConsumidorFinal()
  ✓ is idempotent: 5 calls leave exactly 1 row
  ✓ each tenant gets its own row

POST /api/v1/customers/consumidor-final
  ✓ idempotent endpoint returns 200 with same id on N calls
  ✓ rejects request body with parameters
  ✓ cannot delete the Consumidor Final singleton → 409
```

12 per-branch validation tests cover both happy + negative paths for every
`tipoIdentificacion` (≥ 10 required by TASKS-0031 §2.1 — exceeded).

### 3.3 Migration

The migration creates the `customers` table with one composite-unique and
three helper indexes:

```sql
CREATE TABLE "customers" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "tipoIdentificacion" TEXT NOT NULL,
    "identificacion" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customers_companyId_razonSocial_idx" ON "customers"("companyId", "razonSocial");
CREATE INDEX "customers_companyId_identificacion_idx" ON "customers"("companyId", "identificacion");
CREATE INDEX "customers_companyId_deletedAt_idx" ON "customers"("companyId", "deletedAt");
CREATE UNIQUE INDEX "customers_companyId_tipoIdentificacion_identificacion_key" ON "customers"("companyId", "tipoIdentificacion", "identificacion");
```

## 4. Validation table (per-branch required fields)

| Branch                | identificacion rule (contracts)                                                             | razonSocial                           | direccion                                            | Other rules                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `04` RUC              | 13 digits + sociedad (`6`/`9` + `001` + módulo 11) OR persona natural (cédula + `001..009`) | required, ≤300                        | **required** (defence-in-depth via `validateCreate`) | —                                                                                                          |
| `05` Cédula           | 10 digits, province `01..24`, third `0..5`, módulo 10                                       | required, ≤300                        | **required**                                         | —                                                                                                          |
| `06` Pasaporte        | 1–20 alphanumeric (`[A-Za-z0-9]`)                                                           | required, ≤300                        | **required**                                         | No checksum                                                                                                |
| `07` Consumidor Final | must equal literal `9999999999999`                                                          | must equal literal `CONSUMIDOR FINAL` | optional                                             | Manual create rejected with `customer.use_helper` (409); only `ensureConsumidorFinal()` may write the row. |
| `08` Exterior         | 1–20 chars (any printable string)                                                           | required, ≤300                        | optional                                             | No checksum (foreign IDs vary by jurisdiction)                                                             |

`email`, `telefono`, `nombreComercial` are optional on every branch.
`PATCH` payloads cannot change `tipoIdentificacion` or `identificacion`
(422 `customer.immutable_field`).

## 5. Search behaviour

**Query.** `GET /api/v1/customers?q=<term>&tipoIdentificacion=<04|05|06|07|08>&limit=20&cursor=<ULID>`.

**Predicate built by the handler** (`apps/api/src/customers/handlers.ts:listCustomers`):

```ts
{
  companyId,                // from session, NEVER body
  deletedAt: null,
  ...(tipoIdentificacion ? { tipoIdentificacion } : {}),
  ...(q ? {
    OR: [
      { razonSocial: { startsWith: q, mode: "insensitive" } },  // index: (companyId, razonSocial)
      { identificacion: q },                                     // index: (companyId, identificacion)
    ],
  } : {}),
}
```

**Indexes used.**

- `customers_companyId_razonSocial_idx` — supports the case-insensitive
  `startsWith` prefix scan. Prisma `mode: "insensitive"` compiles to
  Postgres `LOWER(...) LIKE LOWER(...)` which is index-friendly on a
  composite btree when the prefix is anchored at the start.
- `customers_companyId_identificacion_idx` — supports the exact-match
  branch in the `OR`. We intentionally use `=` (not `contains`) on
  identificacion because the security note in SPEC-0031 §10 warns about
  `contains` on identificacion under large catalogs.

**Pagination.** ULID-ordered `id` cursor; `limit` defaults to 20 and is
capped at 50. Response shape: `{ items: CustomerListResponse[], nextCursor: string | null }`.

## 6. ensureConsumidorFinal implementation strategy

`apps/api/src/customers/ensure-consumidor-final.ts` uses a single
`tx.customer.upsert({...})` against the composite-unique index
`(companyId, tipoIdentificacion, identificacion)`. Postgres performs the
upsert atomically — concurrent callers serialise on the unique constraint
and converge to a single row.

```ts
export async function ensureConsumidorFinal(
  tx: EnsureConsumidorFinalTx,
  companyId: string,
): Promise<Customer> {
  return tx.customer.upsert({
    where: {
      companyId_tipoIdentificacion_identificacion: {
        companyId,
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
      },
    },
    update: {},
    create: {
      id: newId(),
      companyId,
      tipoIdentificacion: "07",
      identificacion: "9999999999999",
      razonSocial: "CONSUMIDOR FINAL",
    },
  });
}
```

The helper is generic over `EnsureConsumidorFinalTx = Pick<PrismaClient, "customer">`
so it composes with both the top-level client and `$transaction(...)`
callbacks — the orchestrator (SPEC-0033) can weave it into the same
transaction as the invoice insert.

Two layers of defence prevent stray writes to the singleton row:

1. The unique constraint at the DB level (P2002 on second insert).
2. `validateCreate` in the regular POST path throws `customer.use_helper`
   (409) when `tipoIdentificacion === "07"`, so the helper is effectively
   the only writer.

Additionally, `PATCH` and `DELETE` reject any operation on the singleton
row with `customer.consumidor_final_immutable` (409). Tests cover
idempotency (5 helper calls → 1 row), per-tenant isolation, and the
endpoint variant.

## 7. Endpoints created

| Method | Path                                 | Permission        | Notes                                                                    |
| ------ | ------------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| GET    | `/api/v1/customers`                  | `customer.read`   | Cursor + limit + q + tipoIdentificacion filters. Response excludes PII.  |
| GET    | `/api/v1/customers/:id`              | `customer.read`   | Detail (includes PII). 404 on cross-tenant.                              |
| POST   | `/api/v1/customers`                  | `customer.create` | CSRF + per-branch validation. 409 on duplicate, 409 use_helper for `07`. |
| POST   | `/api/v1/customers/consumidor-final` | `customer.read`   | CSRF. Idempotent upsert. 200 with the persisted row.                     |
| PATCH  | `/api/v1/customers/:id`              | `customer.update` | CSRF. Cannot change identity fields. 422 on attempts.                    |
| DELETE | `/api/v1/customers/:id`              | `customer.delete` | CSRF. Soft-delete only. 409 on the Consumidor Final singleton.           |

RBAC matrix (from `packages/utils/src/rbac/rbac.ts`):

| Permission        | OWNER | ADMIN | ACCOUNTANT | OPERATOR | VIEWER |
| ----------------- | ----- | ----- | ---------- | -------- | ------ |
| `customer.read`   | ✅    | ✅    | ✅         | ✅       | ✅     |
| `customer.create` | ✅    | ✅    | ✅         | ✅       | ❌     |
| `customer.update` | ✅    | ✅    | ✅         | ✅       | ❌     |
| `customer.delete` | ✅    | ✅    | ❌         | ❌       | ❌     |

## 8. Deviations from spec/plan

1. **List response shape excludes PII columns.** SPEC-0031 §FR-2 does not
   explicitly mandate this (it focuses on the model + endpoints), but §10
   ("Email, telefono, direccion are PII") makes it a natural defensive
   posture. The handler exposes a `CustomerListResponse` (no PII) for the
   list endpoint and a `CustomerDetailResponse` (with PII) for the detail
   endpoint. The prompt's hard rule "reads exclude PII fields from list
   responses (PII only on detail)" makes this explicit; PLAN-0031 §4 does
   not differentiate.

2. **Search uses `startsWith` not `contains` on razonSocial.** SPEC-0031
   §FR-6 says "`LIKE %q%`". The prompt overrides with "prefix on
   razonSocial", which the implementation honours. This was an explicit
   prompt instruction; we prefer prefix because the
   `(companyId, razonSocial)` btree is genuinely useful (anchored prefix),
   whereas an unanchored `contains` would force a sequential scan on
   large catalogs. The SPEC-0031 §10 note on `contains` performance is
   exactly the motivation for this decision.

3. **The `08 Exterior` branch allows `direccion` to be optional.** The
   prompt's table only enumerates 04, 05, 06 as requiring direccion;
   PLAN-0031 §4 Phase 2 confirms direccion is optional for 07 and lists
   only 04/05/06 as required. The implementation enforces direccion on
   04/05/06 only, leaving it optional for 07 (Consumidor Final) and 08
   (Exterior, because foreign-address shapes are unknown).

4. **Audit `payloadJson` excludes razonSocial.** The prompt + PLAN-0031
   say "never include the full row payload (just `customerId` + summary)".
   We picked `tipoIdentificacion` as the summary on create/delete (not PII)
   and `changed: string[]` on update (field names only). razonSocial is
   technically not PII per SPEC-0006 §6.3 but tests explicitly assert it's
   absent from audit payloads (matching the spirit of "no full row").

5. **`Customer` model lacks `isActive` boolean.** SPEC-0031 §FR-1 declares
   `isActive Boolean @default(true)`. PLAN-0031 Phase 1 omits it. The
   prompt's hard rules emphasise soft-delete via `deletedAt`; we kept the
   prompt's posture and dropped `isActive` to avoid two parallel
   "tombstone" mechanisms. If the UI needs an explicit "active" flag
   distinct from soft-delete (e.g. "temporarily disable but not delete"),
   it can be added as a follow-up migration without breaking SPEC-0031
   acceptance criteria.

6. **Consumidor-final delete refused.** The spec/plan don't address
   deleting the singleton row. Since the orchestrator (SPEC-0033) depends
   on it, the handler refuses delete with `customer.consumidor_final_immutable`
   (409). Same treatment for PATCH. Tests cover both paths.

## 9. Risks observed

| Risk                                                                                                                                                                         | Likelihood | Mitigation                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres `LOWER(...) LIKE LOWER('q%')` may NOT use the btree index on `(companyId, razonSocial)` because the column collation is the default `C`/`en_US.UTF-8`.              | Medium     | Verified locally on Postgres 16 with `EXPLAIN`. If shown problematic under production load, add a function index `(companyId, lower(razonSocial) text_pattern_ops)`. Flagged for a possible follow-up ADR. |
| `contains` on `identificacion` was downgraded to `=` to keep the index hot. This changes search semantics — users typing a partial `1790...` will not match a full RUC.      | Low        | Documented in §5; UI is expected to surface "exact match" semantics on identificacion. Future: full-text search index.                                                                                     |
| `noUncheckedIndexedAccess`-style fallbacks in `nextCursor` computation use `items[items.length - 1]?.id ?? null`. The conditional is provably reachable so coverage is fine. | Low        | Tested with the pagination test.                                                                                                                                                                           |
| Email is _not_ unique on the customer catalog. A tenant can legitimately have multiple customers sharing the same email (a parent company + subsidiary).                     | Low        | Matches SPEC-0031 §6 "Email column is never used as a unique key for the customer catalog".                                                                                                                |
| Per-branch validation duplicates information already encoded in the discriminated union.                                                                                     | Low        | The duplication is intentional defence-in-depth; both layers must pass. Tested.                                                                                                                            |

## 10. Security review

§6 of the prompt:

- **All queries scoped by `req.companyId`.** Every read/write handler
  reads the active companyId from `req.companyId` (set by `requireTenant`
  middleware after the session check). Body injection is rejected by Zod
  schema strip — and the `companyId-injection` test asserts that an
  injected `companyId` in the body lands the row in `req.companyId`, not
  the foreign one.

- **Reject manual creation of the Consumidor Final identificacion
  (`9999999999999`) outside the helper.** `validateCreate` throws
  `ConflictError("customer.use_helper")` (409) when `tipoIdentificacion === "07"`.
  Tested.

- **Telephone / email are optional; if present they are stored as-is. No
  external lookups.** Confirmed: no I/O outside the Prisma client.

- **Audit rows record `customer.created/updated/deleted` with
  `companyId + actorUserId`; never include the full row payload.**
  Audit `payloadJson` is restricted to `{ tipoIdentificacion }` on
  create/delete and `{ changed: string[] }` on update. Tests assert
  the audit row does NOT contain email/telefono/direccion/razonSocial.

- **Email column is never used as a unique key.** Verified — the only
  unique constraint is `(companyId, tipoIdentificacion, identificacion)`.

Cross-cutting:

- **No PII in logs.** `@facturador/logger` REDACT_PATHS already masks
  `email`, `telefono`, `direccion`, `cedula`, `*.email`, `*.telefono`,
  etc. No additional paths needed.

- **Cross-tenant probes return 404.** Tested (`returns 404 for
cross-tenant id (no enumeration leak)`).

- **No companyId in any request body.** Tested (the injection probe ends
  up with the row pinned to `req.companyId`, not the injected value).

- **Soft-delete only.** No `prisma.customer.delete()` call anywhere in the
  module (verified by grep).

## 11. Suggested follow-ups

1. **CSV import.** SPEC-0031 lists it as out-of-scope for this milestone;
   a follow-up spec should define column mappings + error reporting.

2. **Full-text search.** If the catalog grows past ~10k rows per tenant
   and the prefix match becomes restrictive (e.g. searching by middle of
   a razonSocial), introduce a `pg_trgm` GIN index on `razonSocial`. The
   prompt mentions this as a possibility ("add a gin trigram if helpful");
   we chose to ship with the btree first and revisit under real
   production cardinality.

3. **Customer detail audit with diff.** Currently update-audit payload
   lists changed field names only. A safer richer view could log
   structured before/after diffs while still respecting the PII redaction
   list — useful for forensic reviews.

4. **GDPR-style data export / right-to-be-forgotten.** Out-of-scope but
   inevitable for any PII catalog.

5. **`isActive` flag.** If the UI eventually wants to disable a customer
   without removing them from history, add an explicit `isActive` column
   in a future migration. Not added now to keep soft-delete the single
   tombstone mechanism.

## 12. Sign-off checklist (SPEC-0031 AC-1…AC-7)

- AC-1 (Creating a customer with valid cédula succeeds; invalid cédula returns 400 with the cedula field error): ✅ — see tests `[05 Cédula] valid cédula + direccion → 201` and `[05 Cédula] invalid checksum → 400`.
- AC-2 (Creating a customer with `tipoIdentificacion=07` but `identificacion != "9999999999999"` returns 400): ✅ — see test `[07 Consumidor Final] wrong literal identificacion → 400`. (Note: with the prompt-mandated `customer.use_helper` rule, the legal canonical id also returns a 409 rather than 201 — see AC-5 helper coverage.)
- AC-3 (Duplicate `(tipoIdentificacion, identificacion)` for the same tenant → 409 `customer.duplicate`): ✅ — see test `duplicate (tipoIdentificacion, identificacion) within tenant → 409 customer.duplicate`.
- AC-4 (Same identification across different tenants is allowed): ✅ — see test `same (tipoIdentificacion, identificacion) is allowed across different tenants`.
- AC-5 (`ensureConsumidorFinal` returns the same row on a second call): ✅ — see tests `is idempotent: 5 calls leave exactly 1 row` and `idempotent endpoint returns 200 with the same id on N calls`.
- AC-6 (`GET /api/v1/customers?q=DEMO` returns customers whose razonSocial contains DEMO (case-insensitive)): ✅ — see test `search ?q=ACME does prefix match on razonSocial (case-insensitive)`. (Prefix-not-substring per prompt; documented as deviation §8.2.)
- AC-7 (Cursor pagination yields stable results across pages): ✅ — see test `limit + cursor paginates stably`.

## 13. Definition of Done

- ✅ Every TASKS-0031 box ticked (§1–§7).
- ✅ All 7 SPEC-0031 acceptance criteria validated by tests.
- ✅ Per-branch validation tests pass (12, ≥ 10 required).
- ✅ `ensureConsumidorFinal` idempotent across 5 calls (test verified).
- ✅ Search test seeds 5 customers, asserts ?q=ACME prefix matches both
  "ACME Corp" and "Acme Industries" (case-insensitive).
- ✅ Cross-tenant probe returns 404 with no leak.
- ✅ All finishing-line validations exit 0 (prisma migrate, vitest,
  typecheck, build).
- ✅ Review file (this document) written at
  `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/ai/reviews/0031-customer-catalog-review.md`.
