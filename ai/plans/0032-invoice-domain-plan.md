---
id: PLAN-0032
spec: SPEC-0032
title: Invoice domain — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0032 — Invoice domain

> Implementation plan for [SPEC-0032](../specs/0032-invoice-domain.md). Depends on PLAN-0004/0005/0006/0010/0011/0030/0031.

## 1. Goal

Model the factura aggregate with strict arithmetic and validations:

- `Invoice`, `InvoiceLine`, `InvoicePayment`, `InvoiceAdicional` models.
- Pure `computeInvoice(input)` returning totals (Decimal-based, no float drift).
- IVA rate validity windows: 15% from 2024-04-01; 12% before. Other codes (0, 14, etc.) per SRI table.
- Payments sum must equal `importeTotal` within ±0.01.
- CRUD endpoints for drafts; list endpoint with cursor pagination + filters.

## 2. Inputs

- [SPEC-0032](../specs/0032-invoice-domain.md) — authoritative.
- [SPEC-0005](../specs/0005-shared-contracts.md) — invoice schemas.
- [SPEC-0030](../specs/0030-emission-points-and-sequencing.md) — `reserveSecuencial` consumed by SPEC-0033 (orchestrator).
- [SPEC-0031](../specs/0031-customer-catalog.md) — `Customer`.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                               | Rationale                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| **decimal.js** for all arithmetic; never `Number`. Round-half-away-from-zero, 2 decimals for money, 6 for cantidad/precioUnitario.                                                                                     | Avoids float drift.                         |
| `computeInvoice(input)` is **pure**: input is the shape with lines + payments + ambient fechaEmision + tax-rate resolver. Output: `{ totalSinImpuestos, totalDescuento, totalConImpuestos: TaxLine[], importeTotal }`. | Single source of truth for math.            |
| IVA rate table per `docs/sri-...`: validity windows + codes. A helper `pickIvaCode(fecha)` returns `{ codigo, porcentaje }`.                                                                                           | Centralised; reused by web (SPEC-0042).     |
| Models persist computed totals + line-level computed fields so the list view doesn't recompute.                                                                                                                        | Trade-off: small redundancy; reads cheaper. |
| Estado: `BORRADOR                                                                                                                                                                                                      | EMITIDO                                     | ANULADO` at the Invoice level (independent of SriDocument.estado). | SRI lifecycle lives in sri-core; api tracks user-facing state. |
| Cursor pagination by `(createdAt DESC, id DESC)` with ULID as tiebreak.                                                                                                                                                | Stable order.                               |
| `preview-totals` endpoint runs `computeInvoice` without persisting.                                                                                                                                                    | Live UX.                                    |

### Money math contract

- Each `InvoiceLine`:
  - `cantidad` (6 dp).
  - `precioUnitario` (6 dp).
  - `descuento` (2 dp).
  - `precioTotalSinImpuesto = (cantidad × precioUnitario) − descuento`, rounded 2 dp.
  - Per impuesto: `baseImponible`, `valor` (`baseImponible × porcentaje / 100`), 2 dp.
- Invoice totals:
  - `totalSinImpuestos = Σ line.precioTotalSinImpuesto`, 2 dp.
  - `totalDescuento = Σ line.descuento`, 2 dp.
  - `totalConImpuestos[c]` aggregates per `(codigo, codigoPorcentaje)` over all lines: `Σ baseImponible`, `Σ valor`.
  - `importeTotal = totalSinImpuestos + Σ totalConImpuestos.valor`, 2 dp.

## 4. Phases

### Phase 1 — Models

```prisma
model Invoice {
  id String @id @db.Char(26)
  companyId String
  customerId String
  estab String
  ptoEmi String
  secuencial String?
  claveAcceso String? @unique
  fechaEmision DateTime  // local-date midnight
  ambiente String
  tipoEmision String
  estado String  // BORRADOR | EMITIDO | ANULADO
  totalSinImpuestos Decimal @db.Decimal(12,2)
  totalDescuento Decimal @db.Decimal(12,2)
  importeTotal Decimal @db.Decimal(12,2)
  totalsJson Json
  mensajesJson Json?
  emittedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lines InvoiceLine[]
  payments InvoicePayment[]
  adicionales InvoiceAdicional[]
  @@index([companyId, createdAt])
  @@index([companyId, estado, createdAt])
}
model InvoiceLine {
  id String @id @db.Char(26)
  invoiceId String
  invoice Invoice @relation(fields:[invoiceId], references:[id], onDelete: Cascade)
  codigoPrincipal String?
  codigoAuxiliar String?
  descripcion String
  cantidad Decimal @db.Decimal(14,6)
  precioUnitario Decimal @db.Decimal(14,6)
  descuento Decimal @db.Decimal(12,2)
  precioTotalSinImpuesto Decimal @db.Decimal(12,2)
  impuestosJson Json  // [{codigo,codigoPorcentaje,baseImponible,valor}]
  ord Int  // line order
}
model InvoicePayment {
  id String @id @db.Char(26)
  invoiceId String
  invoice Invoice @relation(fields:[invoiceId], references:[id], onDelete: Cascade)
  formaPago String  // SRI catalog
  total Decimal @db.Decimal(12,2)
  plazo Int?  // days
  unidadTiempo String?
  ord Int
}
model InvoiceAdicional {
  id String @id @db.Char(26)
  invoiceId String
  invoice Invoice @relation(fields:[invoiceId], references:[id], onDelete: Cascade)
  nombre String
  valor String
  ord Int
}
```

Migration `billing_invoices`.

### Phase 2 — Pure compute

`apps/api/src/invoices/compute.ts`:

- `computeInvoice(input)` per the contract above.
- Returns the persisted shape's totals + lines' computed fields.
- Imports `decimal.js` and `pickIvaCode`.

`apps/api/src/invoices/tax-rates.ts`:

- `pickIvaCode(fechaEmision: Date)` returns `{ codigo:"2", codigoPorcentaje:"4", porcentaje:15 }` for ≥ 2024-04-01, else `{codigo:"2", codigoPorcentaje:"2", porcentaje:12}`.
- Also exposes `IVA_TABLE` for UI display.

### Phase 3 — Endpoints

- `POST /api/v1/invoices` (`invoice.create`): creates a BORRADOR. Body validates via `CreateInvoiceSchema`. Server fills computed totals; customerId must belong to the same tenant.
- `PATCH /api/v1/invoices/:id` (`invoice.create`): only while BORRADOR. Recomputes totals.
- `POST /api/v1/invoices/:id/preview-totals` (`invoice.create`): returns computed totals from a body without persisting.
- `GET /api/v1/invoices?estado=&from=&to=&q=&limit=&cursor=` (`invoice.read`): list with filters + cursor pagination.
- `GET /api/v1/invoices/:id` (`invoice.read`): detail including SriDocument state (joined via sri-core proxy or via a denormalised mirror; for v1 the api stores a `sriEstado` mirror updated when sri-core responds).
- `DELETE /api/v1/invoices/:id` (`invoice.create`): only while BORRADOR.

### Phase 4 — Payment sum guard

In `POST /:id/emit` (orchestrator path — implemented in SPEC-0033 but the guard belongs here): assert `|Σ payments − importeTotal| ≤ 0.01`. The API exposes the same check on `PATCH` and returns a `business_error` chip (warning) if mismatched — Emit endpoint will reject hard.

### Phase 5 — Tests

- Unit: `computeInvoice` covers
  - One line, IVA 15% → totals match `100/15/115`.
  - Multiple lines with discount.
  - Mixed IVA codes (0% + 15%).
  - Cantidad with 6 dp rounding.
  - Property test: sum of lines == totalSinImpuestos to 2 dp.
- Integration:
  - Create draft, list with filters, get detail, preview-totals matches stored after PATCH.
  - VIEWER cannot create.
  - Cross-tenant probe returns 404.

## 5. Risks & mitigations

| Risk                                                   | Mitigation                                        |
| ------------------------------------------------------ | ------------------------------------------------- |
| Float drift via accidental `Number`.                   | Lint rule + code review; all math via decimal.js. |
| IVA rate misapplication around 2024-04-01.             | Unit tests with fechaEmision on the boundary.     |
| Stored totals out of sync after partial update.        | Every write recomputes totals before persisting.  |
| Cursor pagination misses rows on insert during paging. | `(createdAt DESC, id DESC)` cursor format.        |

## 6. Validation strategy

- Compute tests pass.
- Endpoint tests pass.
- Property test confirms sum invariants for random inputs.

## 7. Exit criteria

- All SPEC-0032 ACs pass.
- `computeInvoice` used by both endpoint paths and the orchestrator.

## 8. Out of scope

- Emit pipeline → SPEC-0033.
- RIDE PDF — later.
- Anulación at SRI — later.
