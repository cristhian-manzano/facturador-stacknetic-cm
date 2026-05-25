---
id: TASKS-0030
spec: SPEC-0030
plan: PLAN-0030
title: Emission points & sequencing — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0030 — Emission points & sequencing

> Checklist for [SPEC-0030](../specs/0030-emission-points-and-sequencing.md) + [PLAN-0030](../plans/0030-emission-points-and-sequencing-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never reuse a secuencial. Once reserved, it's consumed.
- ❌ Never accept `companyId` from request body. Always `req.companyId`.
- ❌ Never hard-delete establecimientos / emission points; soft-delete only.
- ✅ Reservation runs at Serializable isolation; retries up to 3 times on conflict.
- ✅ Concurrency stress test must pass with zero duplicates.

## 1. Migration

- [ ] **1.1** Add models per PLAN §4 Phase 1 to `prisma/schema.prisma`. Generate migration `billing_emission_points`.
      **Validate**: `pnpm prisma validate` 0; `pnpm prisma migrate dev --name billing_emission_points` writes a migration containing each table.

## 2. Reservation service

- [ ] **2.1** `apps/api/src/sequencing/reserve.ts` exports `reserveSecuencial`:

  - Signature: `(deps: { prisma }, args: { companyId, estab, ptoEmi, tipoComprobante }): Promise<string>`.
  - Inside `prisma.$transaction(async tx => {...}, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 })`:
    - Upsert counter (create with `value=0` if absent).
    - `tx.$queryRaw` an `UPDATE ... SET value = value + 1 RETURNING value` against the row.
    - Return `value.toString().padStart(9, "0")`.
  - On `PrismaClientKnownRequestError` with code `40001`/`P2034` (serialization), retry up to 3 times with 50–200 ms backoff.
    **Validate**: unit test with a single worker reserves 5 in sequence; values "000000001"…"000000005".

- [ ] **2.2** Concurrency stress test:
  - 20 workers (Vitest `Promise.all`) × 100 reservations each = 2000 total.
  - Assert: set size == 2000; max - min + 1 ≥ 2000 (monotonic, no duplicates).
    **Validate**: pass; document elapsed time in the review file.

## 3. Burn helper

- [ ] **3.1** `apps/api/src/sequencing/burn.ts`: `burnSecuencial(tx, { companyId, estab, ptoEmi, tipoComprobante, secuencial, reason })` inserts a `BurnedSecuencial` row.
      **Validate**: unit test asserts row exists; integration test exercises within a transaction.

## 4. CRUD endpoints

For each route, requires `requireSession` → `requireTenant` → `requirePermission(...)` as documented.

- [ ] **4.1** `GET /api/v1/establecimientos` (no permission gate; readable for tenant members).
      **Validate**: returns rows scoped to `req.companyId`; excludes `deletedAt IS NOT NULL`.

- [ ] **4.2** `POST /api/v1/establecimientos` (`establecimiento.manage`). Body: `{ codigo, direccion, isMatriz? }`. Codigo must be 3 digits; unique per tenant.
      **Validate**: 201 returns the new row; duplicate codigo → 409.

- [ ] **4.3** `PATCH /api/v1/establecimientos/:id` (`establecimiento.manage`).
      **Validate**: VIEWER → 403; OWNER → 200.

- [ ] **4.4** `DELETE /api/v1/establecimientos/:id` (`establecimiento.manage`). Soft-delete only.
      **Validate**: row's `deletedAt` set; subsequent GET excludes it.

- [ ] **4.5** `GET /api/v1/establecimientos/:id/emission-points`.
      **Validate**: returns rows scoped properly.

- [ ] **4.6** `POST /api/v1/establecimientos/:id/emission-points` (`establecimiento.manage`). Body: `{ codigo, descripcion, isDefault? }`. Codigo 3 digits; unique per establecimiento. When `isDefault: true`, in a transaction, clear `isDefault` on all sibling emission points.
      **Validate**: integration test creates two emission points; setting second as default flips the first off.

- [ ] **4.7** `PATCH /api/v1/emission-points/:id` (`establecimiento.manage`).
      **Validate**: same as 4.3.

- [ ] **4.8** `DELETE /api/v1/emission-points/:id` (`establecimiento.manage`). Soft-delete.
      **Validate**: 204; `deletedAt` set.

## 5. Cross-tenant defence

- [ ] **5.1** User in tenant T1 attempts to PATCH an establecimiento belonging to T2 → 404 (do not leak existence).
      **Validate**: pass.

## 6. Audit events

- [ ] **6.1** Emit:
  - `establecimiento.created|updated|deleted`
  - `emission_point.created|updated|deleted`
  - `secuencial.burned`
    **Validate**: integration tests assert audit rows.

## 7. Acceptance criteria

- [ ] AC-1: `reserveSecuencial` returns monotonic unique 9-digit strings under 20×100 concurrency.
- [ ] AC-2: Serializable retries handled up to 3 times.
- [ ] AC-3: No release / no reuse path exists.
- [ ] AC-4: Burn helper writes audit row.
- [ ] AC-5: Establecimientos / emission points have CRUD with RBAC gating.
- [ ] AC-6: Soft-delete only; counters persist after delete.
- [ ] AC-7: Cross-tenant probes return 404 / 403 without leaking existence.

## 8. Definition of Done

- All boxes ticked; concurrency test passes; all integration tests green.
- Review file `ai/reviews/0030-emission-points-and-sequencing-review.md` written.
