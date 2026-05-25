---
id: TASKS-0031
spec: SPEC-0031
plan: PLAN-0031
title: Customer catalog — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0031 — Customer catalog

> Checklist for [SPEC-0031](../specs/0031-customer-catalog.md) + [PLAN-0031](../plans/0031-customer-catalog-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `companyId` in request bodies. Always `req.companyId`.
- ❌ No hard deletes.
- ❌ Consumidor Final identificacion is fixed `9999999999999`; never accept overrides.
- ✅ Validation per `tipoIdentificacion` enforced both at the contract layer (Zod) and at the service layer (defence-in-depth).
- ✅ `ensureConsumidorFinal` idempotent; calling it 5 times leaves exactly 1 row.

## 1. Migration

- [ ] **1.1** Add `Customer` model per PLAN §4 Phase 1 to `prisma/schema.prisma`. Migration `billing_customers`.
      **Validate**: `pnpm prisma validate` 0; `migrate dev` creates the table; `prisma migrate status` clean.

## 2. Validation layer

- [ ] **2.1** `apps/api/src/customers/validate.ts`:
  - `validateCreate(input)` parses via `CreateCustomerSchema`, then applies per-branch rules (e.g., 04 → `direccion` required and `identificacion` passes `RucSchema`).
  - `validateUpdate(input)`.
    **Validate**: per-branch unit tests (one happy + one negative each = 10 tests min).

## 3. Endpoints

- [ ] **3.1** `GET /api/v1/customers?q=&tipoIdentificacion=&limit=20&cursor=`:

  - Scope: `req.companyId`, `deletedAt IS NULL`.
  - `q` matches prefix on `razonSocial` (case-insensitive) OR substring on `identificacion`.
  - Cursor: ULID-based (use `id` ordering).
  - Returns `{ items: Customer[], nextCursor: string|null }`.
    **Validate**: seed 5 customers; `?q=ABC` returns matches; `?limit=2` paginates; cross-tenant request scoped properly.

- [ ] **3.2** `GET /api/v1/customers/:id`: returns one or 404 (404 if either nonexistent or cross-tenant).
      **Validate**: pass.

- [ ] **3.3** `POST /api/v1/customers` (`customer.create`):

  - Body validated via `validateCreate`.
  - 409 on duplicate `(tipoIdentificacion, identificacion)` per tenant.
  - Audit `customer.created`.
    **Validate**: VIEWER → 403; OPERATOR → 201; duplicate → 409.

- [ ] **3.4** `PATCH /api/v1/customers/:id` (`customer.update`):

  - Body validated; cannot change `tipoIdentificacion` once set.
  - Audit `customer.updated`.
    **Validate**: attempting to change `tipoIdentificacion` → 422; happy path → 200.

- [ ] **3.5** `DELETE /api/v1/customers/:id` (`customer.delete`): soft-delete.
      **Validate**: ADMIN → 204; VIEWER/OPERATOR → 403; subsequent GET excludes the row.

## 4. Consumidor Final helper

- [ ] **4.1** `apps/api/src/customers/ensure-consumidor-final.ts`:
  - `ensureConsumidorFinal(tx, companyId): Promise<Customer>` via upsert on the composite unique.
    **Validate**: integration test:
  - First call inserts a row.
  - Second + third calls return same `id` with no new rows.
  - The row has `tipoIdentificacion === "07"` and `identificacion === "9999999999999"`.

## 5. Cross-tenant probes

- [ ] **5.1** Create customer in T1. User in T2 attempts GET by id → 404 (no leak).
      **Validate**: pass.

- [ ] **5.2** User in T2 attempts `POST` with `?companyId=T1` in query — query is ignored; row created in T2.
      **Validate**: row created in T2, not T1.

## 6. Audit

- [ ] **6.1** Audit rows for `customer.created|updated|deleted`.
      **Validate**: rows asserted via DB.

## 7. Acceptance criteria

- [ ] AC-1: Discriminated validation enforced.
- [ ] AC-2: Duplicate detection per `(companyId, tipoIdentificacion, identificacion)`.
- [ ] AC-3: `ensureConsumidorFinal` idempotent.
- [ ] AC-4: Search with `?q=` works on razonSocial + identificacion.
- [ ] AC-5: Soft-delete only; deleted rows excluded.
- [ ] AC-6: RBAC enforced per route.
- [ ] AC-7: Cross-tenant requests return 404 without leaking existence.

## 8. Definition of Done

- All boxes ticked; all tests green.
- Review file `ai/reviews/0031-customer-catalog-review.md` written.
