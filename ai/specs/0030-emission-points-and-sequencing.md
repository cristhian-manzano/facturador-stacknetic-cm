---
id: SPEC-0030
title: Establecimientos, puntos de emisión & secuenciales
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0011]
blocks: [SPEC-0032, SPEC-0033]
---

# SPEC-0030 — Emission points & sequencing

## 1. Purpose

Model the SRI emission infrastructure (`establecimiento`, `punto de emisión`) and atomically reserve a `secuencial` per `(company, estab, ptoEmi, codDoc)` so that two concurrent invoice emissions never collide. Sequence integrity is fraud-grade — gaps and duplicates **must** be impossible.

## 2. Scope

### 2.1 In scope

- `Establecimiento` and `EmissionPoint` models in API's Prisma schema.
- CRUD endpoints under `/api/v1/emission-points`.
- Atomic `reserveSecuencial({ companyId, estab, ptoEmi, codDoc }): Promise<string>` using `SELECT ... FOR UPDATE` inside a transaction.
- `releaseSecuencial(...)` is **not** supported (per SRI: a reserved sequential is burned if the document is rejected; never reused).
- Tracking burned sequentials in a `BurnedSecuencial` table for forensic visibility and operator review.
- Listing burned sequentials per emission point.

### 2.2 Out of scope

- Multi-region replication (single Postgres for now).
- High-throughput sequence generation (Postgres sequences are fine at v1).

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §3 — sequencing rules.
- [`ai/context/glossary.md`](../context/glossary.md) — emission infra terminology.
- [SPEC-0004](./0004-database-and-prisma.md) — Prisma conventions.

## 4. Functional requirements

- **FR-1.** Models:

  ```prisma
  model Establecimiento {
    id           String   @id
    companyId    String
    codigo       String   // 3 digits
    nombre       String?
    direccion    String
    isActive     Boolean  @default(true)
    createdAt    DateTime @default(now())
    updatedAt    DateTime @updatedAt
    deletedAt    DateTime?

    company      Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
    emissionPoints EmissionPoint[]

    @@unique([companyId, codigo])
    @@index([companyId, isActive])
    @@map("establecimientos")
  }

  model EmissionPoint {
    id                 String   @id
    companyId          String
    establecimientoId  String
    codigo             String   // 3 digits (ptoEmi)
    isActive           Boolean  @default(true)
    createdAt          DateTime @default(now())
    updatedAt          DateTime @updatedAt
    deletedAt          DateTime?

    company            Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
    establecimiento    Establecimiento @relation(fields: [establecimientoId], references: [id], onDelete: Cascade)
    counters           SecuencialCounter[]

    @@unique([establecimientoId, codigo])
    @@index([companyId, isActive])
    @@map("emission_points")
  }

  model SecuencialCounter {
    id              String   @id
    companyId       String
    emissionPointId String
    codDoc          String   // '01' factura, '04' NC, ...
    next            Int      @default(1) // next value to assign (1..999_999_999)
    updatedAt       DateTime @updatedAt

    emissionPoint   EmissionPoint @relation(fields: [emissionPointId], references: [id], onDelete: Cascade)

    @@unique([emissionPointId, codDoc])
    @@index([companyId])
    @@map("secuencial_counters")
  }

  model BurnedSecuencial {
    id              String   @id
    companyId       String
    emissionPointId String
    codDoc          String
    secuencial      String   // 9-digit padded
    reason          String   // e.g. "DEVUELTA", "NO_AUTORIZADO", "MANUAL_BURN"
    burnedByUserId  String?
    createdAt       DateTime @default(now())

    @@index([companyId, emissionPointId, codDoc, createdAt])
    @@map("burned_secuenciales")
  }
  ```

- **FR-2.** Endpoints (Express, all tenant-scoped, RBAC via [SPEC-0011](./0011-tenants-memberships-rbac.md)):

  ```
  GET    /api/v1/establecimientos                emissionPoint.read
  POST   /api/v1/establecimientos                emissionPoint.write
  PATCH  /api/v1/establecimientos/:id            emissionPoint.write
  DELETE /api/v1/establecimientos/:id            emissionPoint.write (soft delete; must have no active EmissionPoint)

  GET    /api/v1/emission-points                 emissionPoint.read
  POST   /api/v1/emission-points                 emissionPoint.write   body: { establecimientoId, codigo }
  PATCH  /api/v1/emission-points/:id             emissionPoint.write
  DELETE /api/v1/emission-points/:id             emissionPoint.write

  GET    /api/v1/emission-points/:id/burned      emissionPoint.read    list burned sequentials
  ```

- **FR-3.** `reserveSecuencial({ companyId, emissionPointId, codDoc })`:

  - In a Prisma `$transaction` with `isolationLevel: "Serializable"`:
    1. `findUnique` or `upsert` the `SecuencialCounter` row.
    2. `update next++`.
  - Return the **previous** `next` zero-padded to 9 digits.
  - Throws `invoice.sequential_overflow` if `next > 999_999_999`.

- **FR-4.** `burnSecuencial({ companyId, emissionPointId, codDoc, secuencial, reason, actorUserId })`:

  - Inserts a `BurnedSecuencial` row.
  - Does **not** decrement the counter — the next emission gets `secuencial + 1`.
  - Audited as `invoice.secuencial_burned`.

- **FR-5.** Creating an `EmissionPoint` initialises its `SecuencialCounter` for `codDoc='01'` at `next=1` (and other codDocs lazily on first reserve).

- **FR-6.** Deleting an `EmissionPoint` (soft) refuses if it has un-finalised invoices in `PENDIENTE | FIRMADO | ENVIADO | RECIBIDA | EN_PROCESO | ERROR_RED`.

## 5. Non-functional requirements

- **NFR-1.** `reserveSecuencial` P95 ≤ 20 ms under contention from 10 concurrent emissions per emission point (sequential by definition).
- **NFR-2.** No race condition allows two emissions to receive the same `secuencial`.

## 6. Technical design

### 6.1 `reserveSecuencial` reference impl

```ts
// apps/api/src/billing/secuencial/reserve.ts
import { Prisma, prisma } from "../../db/client.js";
import { AppError } from "../../errors/app-error.js";
import { ulid } from "ulid";

const pad9 = (n: number) => n.toString().padStart(9, "0");

export const reserveSecuencial = (input: {
  companyId: string;
  emissionPointId: string;
  codDoc: string;
}): Promise<string> =>
  prisma.$transaction(
    async (tx) => {
      // Upsert counter (lock row).
      const existing = await tx.secuencialCounter.findUnique({
        where: {
          emissionPointId_codDoc: { emissionPointId: input.emissionPointId, codDoc: input.codDoc },
        },
      });
      const counter = existing
        ? await tx.secuencialCounter.update({
            where: { id: existing.id },
            data: { next: { increment: 1 } },
          })
        : await tx.secuencialCounter.create({
            data: {
              id: ulid(),
              companyId: input.companyId,
              emissionPointId: input.emissionPointId,
              codDoc: input.codDoc,
              next: 2,
            },
          });
      const reserved = existing ? counter.next - 1 : 1;
      if (reserved > 999_999_999)
        throw new AppError("invoice.sequential_overflow", 409, "Secuencial space exhausted");
      return pad9(reserved);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
```

The `Serializable` isolation level ensures the read-then-update is conflict-free; Postgres retries internally up to the connection limit.

### 6.2 `burnSecuencial`

```ts
export const burnSecuencial = async (input: {
  companyId: string;
  emissionPointId: string;
  codDoc: string;
  secuencial: string;
  reason: "DEVUELTA" | "NO_AUTORIZADO" | "MANUAL_BURN";
  actorUserId?: string;
}) => {
  await prisma.burnedSecuencial.create({
    data: { id: ulid(), ...input },
  });
  await audit({
    action: "invoice.secuencial_burned",
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    metadata: { ...input },
  });
};
```

### 6.3 Handlers (sketch)

`createEmissionPoint`:

```ts
const Body = z.object({ establecimientoId: z.string(), codigo: z.string().regex(/^\d{3}$/) });

export const createEmissionPoint: RequestHandler = async (req, res) => {
  const tenant = (req as any).tenant;
  const { establecimientoId, codigo } = Body.parse(req.body);

  const est = await prisma.establecimiento.findFirst({
    where: { id: establecimientoId, companyId: tenant.id, deletedAt: null },
  });
  if (!est) throw new NotFoundError("establecimiento");

  const created = await prisma.$transaction(async (tx) => {
    const ep = await tx.emissionPoint.create({
      data: { id: ulid(), companyId: tenant.id, establecimientoId, codigo },
    });
    await tx.secuencialCounter.create({
      data: { id: ulid(), companyId: tenant.id, emissionPointId: ep.id, codDoc: "01", next: 1 },
    });
    return ep;
  });
  res.status(201).json(created);
};
```

## 7. Implementation guide

### 7.1 Steps

1. Add models in §FR-1 to `apps/api/prisma/schema.prisma`. Migrate.
2. Implement repositories and `reserveSecuencial` / `burnSecuencial`.
3. Implement routes.
4. Update seed to also create a default `Establecimiento(001)` and `EmissionPoint(001)` for the demo tenant.
5. Integration tests covering:
   - Concurrent reservations (50 parallel calls) yield 50 distinct sequentials with no gaps.
   - Deleting an EmissionPoint with active invoices is forbidden.
   - Burning a sequential records the row but does not roll back the counter.

### 7.2 Dependencies

(None new.)

### 7.3 Conventions

- All sequencing logic lives in `apps/api/src/billing/secuencial/`. Do not duplicate.
- Never compute `secuencial` outside `reserveSecuencial`.
- Burns are decided by [SPEC-0033](./0033-invoice-emission-orchestrator.md): when SRI returns `DEVUELTA`/`NO_AUTORIZADO`, the orchestrator burns the sequential before re-emit (which uses a fresh sequence) — unless the operator chooses to correct and resend with the same clave (allowed for some `DEVUELTA` errors).

## 8. Acceptance criteria

- **AC-1.** Two parallel calls to `reserveSecuencial` for the same `(emissionPoint, codDoc)` produce `000000001` and `000000002`, never duplicates.
- **AC-2.** Reserving up to `999_999_999` succeeds; the next call throws `invoice.sequential_overflow`.
- **AC-3.** Burning sequential `000000005` records a row; the next reservation still returns `000000007` (not `000000005`).
- **AC-4.** Soft-delete on an `EmissionPoint` with an active invoice returns `409 emissionPoint.has_pending_invoices`.
- **AC-5.** A user without `emissionPoint.write` cannot create an emission point (`403`).
- **AC-6.** RBAC: `VIEWER` can list emission points; `OPERATOR` cannot create them.

## 9. Test plan

- Stress: 50 concurrent reservations → 50 distinct sequentials.
- Negative: invalid `codigo` format → 400.
- Tenant isolation: user from tenant A cannot read tenant B's emission points (404 not 403).

## 10. Security considerations

- Tenant filter on every read.
- `BurnedSecuencial` rows are append-only.
- Operators with `VIEWER` see counts (not raw secuenciales unless they have `emissionPoint.read`).

## 11. Observability

- Audit `emissionPoint.created`, `emissionPoint.activated`, `emissionPoint.soft_deleted`, `invoice.secuencial_burned`.
- Metric (future): `secuencial_reserve_duration_ms`, `secuencial_burns_total{reason}`.

## 12. Risks and mitigations

| Risk                                           | Mitigation                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Concurrent reservations starve under high load | `Serializable` retries handled by Prisma; if it ever exceeds capacity, switch to Postgres sequence (`CREATE SEQUENCE`). |
| Operator deletes wrong emission point          | Soft delete only; restore via DB script in incident.                                                                    |
| Sequential exhaustion (extreme)                | Hard cap; emit alert at 990_000_000.                                                                                    |

## 13. Open questions

- Should we model `tipoEmision` (normal/contingencia) per emission point? Per docs §1, contingencia is deprecated. Skip until SRI changes policy.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
