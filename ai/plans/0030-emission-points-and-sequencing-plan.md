---
id: PLAN-0030
spec: SPEC-0030
title: Emission points & sequencing — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0030 — Emission points & sequencing

> Implementation plan for [SPEC-0030](../specs/0030-emission-points-and-sequencing.md). Depends on PLAN-0004/0005/0006/0010/0011.

## 1. Goal

Model SRI's "Establecimiento" + "Punto de Emisión" + per-tenant secuencial counters, with **atomic reservation** to avoid duplicate sequences. After this slice:

- `Establecimiento`, `EmissionPoint`, `SecuencialCounter`, `BurnedSecuencial` models.
- `reserveSecuencial({ companyId, estab, ptoEmi, tipoComprobante })` returns the next 9-digit string and increments the counter inside a Serializable transaction.
- "Burned secuenciales" are recorded when a reissue happens (the old secuencial cannot ever be reused per SRI rules).
- CRUD endpoints for establecimientos and emission points (scoped to tenant; protected by `establecimiento.manage`).

## 2. Inputs

- [SPEC-0030](../specs/0030-emission-points-and-sequencing.md) — authoritative.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — sequencing rules.
- [SPEC-0011](../specs/0011-tenants-memberships-rbac.md) — `requirePermission`.

## 3. Architecture decisions

| Decision                                                                                                                 | Rationale                                          |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Models live in `apps/api` Prisma scope (api owns billing data).                                                          | Domain ownership clear.                            |
| `SecuencialCounter` PK = `(companyId, estab, ptoEmi, tipoComprobante)` composite.                                        | One counter per emission tuple.                    |
| Reservation in `Prisma.TransactionIsolationLevel.Serializable`. Counter row updated `value = value + 1 RETURNING value`. | Strict no-gap-no-dup.                              |
| **No releaseSecuencial**. Once reserved, the number is consumed regardless of outcome.                                   | SRI rules: holes are okay; reusing numbers is not. |
| `BurnedSecuencial` records `(companyId, estab, ptoEmi, tipoComprobante, secuencial, reason, burnedAt)`.                  | Audit + analytics.                                 |
| 9-digit secuencial; pad with leading zeros.                                                                              | SRI format.                                        |
| Default emission point per establecimiento (`isDefault: true`); UI uses it as initial selection.                         | UX.                                                |
| Soft delete establecimientos (deletedAt) — never hard-delete; counters persist.                                          | Audit history.                                     |

## 4. Phases

### Phase 1 — Models

```prisma
model Establecimiento {
  id String @id @db.Char(26)
  companyId String
  codigo String  // estab, 3 digits
  direccion String
  isMatriz Boolean @default(false)
  deletedAt DateTime?
  @@unique([companyId, codigo])
}
model EmissionPoint {
  id String @id @db.Char(26)
  establecimientoId String
  codigo String  // ptoEmi, 3 digits
  descripcion String
  isDefault Boolean @default(false)
  deletedAt DateTime?
  @@unique([establecimientoId, codigo])
}
model SecuencialCounter {
  companyId String
  estab String
  ptoEmi String
  tipoComprobante String  // "01" factura
  value BigInt @default(0)
  @@id([companyId, estab, ptoEmi, tipoComprobante])
}
model BurnedSecuencial {
  id String @id @db.Char(26)
  companyId String
  estab String
  ptoEmi String
  tipoComprobante String
  secuencial String
  reason String  // 'reissue' | 'manual'
  burnedAt DateTime @default(now())
  @@index([companyId, estab, ptoEmi, tipoComprobante])
}
```

Migration `billing_emission_points`.

### Phase 2 — Reservation service

`apps/api/src/sequencing/reserve.ts`:

- `reserveSecuencial({ companyId, estab, ptoEmi, tipoComprobante })`:
  - Uses `prisma.$transaction(async tx => { ... }, { isolationLevel: 'Serializable' })`.
  - Upsert the counter row (create if missing).
  - `UPDATE "SecuencialCounter" SET value = value + 1 WHERE ... RETURNING value`.
  - Return `value.toString().padStart(9,"0")`.
- On serialization conflicts, retry up to 3 times with small backoff.

### Phase 3 — Endpoints

`apps/api/src/establecimientos/routes.ts`:

- `GET /api/v1/establecimientos` (requires session+tenant).
- `POST /api/v1/establecimientos` (`establecimiento.manage`).
- `PATCH /api/v1/establecimientos/:id` (`establecimiento.manage`).
- `DELETE /api/v1/establecimientos/:id` (`establecimiento.manage`) — soft delete.
- `GET /api/v1/establecimientos/:id/emission-points`.
- `POST /api/v1/establecimientos/:id/emission-points` (`establecimiento.manage`).
- `PATCH /api/v1/emission-points/:id` (`establecimiento.manage`).
- `DELETE /api/v1/emission-points/:id` (`establecimiento.manage`) — soft delete (refuse if it's the only one for an active establecimiento? document policy: allow soft delete; UI surfaces a warning).

### Phase 4 — Stress test

A Vitest that fires `reserveSecuencial` from N concurrent workers; asserts unique sequence values (no duplicates) and no gaps (per spec — gaps may be acceptable; assert at minimum monotonic increasing).

### Phase 5 — Reissue helper

`apps/api/src/sequencing/burn.ts`:

- `burnSecuencial(prisma, { companyId, estab, ptoEmi, tipoComprobante, secuencial, reason })` inserts a `BurnedSecuencial` row inside the caller's transaction.

## 5. Risks & mitigations

| Risk                                              | Mitigation                                                      |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Serializable transactions throw under contention. | Retry up to 3 times with backoff; document expected throughput. |
| Counter row created twice in race.                | Upsert; the unique PK guards against duplicates.                |
| Soft-deleted establecimiento still queried.       | Default queries include `deletedAt IS NULL`.                    |
| Default emission point flag toggled badly.        | Update wraps both rows in a transaction.                        |

## 6. Validation strategy

- Concurrency test (20 workers × 100 reservations): exactly 2000 unique values returned.
- Endpoint tests cover happy and forbidden cases.
- Burn helper test creates a row inside a transaction.

## 7. Exit criteria

- All SPEC-0030 ACs pass.
- Concurrency stress passes.
- `burnSecuencial` integrated; SPEC-0033 consumers will call it.

## 8. Out of scope

- Per-emission-point cert binding — later spec.
- Multi-region (per-tenant DB) — out.
