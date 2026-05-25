---
id: TASKS-0032
spec: SPEC-0032
plan: PLAN-0032
title: Invoice domain — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0032 — Invoice domain

> Checklist for [SPEC-0032](../specs/0032-invoice-domain.md) + [PLAN-0032](../plans/0032-invoice-domain-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `Number` for monetary arithmetic. Everything via decimal.js.
- ❌ No `companyId` in request body.
- ❌ No edit/delete after `estado === "EMITIDO"`.
- ✅ `preview-totals` results MUST equal stored totals after a subsequent identical PATCH.
- ✅ Property test: `Σ line.precioTotalSinImpuesto === totalSinImpuestos` to 2 dp for 100 random inputs.

## 1. Models

- [ ] **1.1** Add `Invoice`, `InvoiceLine`, `InvoicePayment`, `InvoiceAdicional` to `prisma/schema.prisma` per PLAN §4 Phase 1. Migration `billing_invoices`.
      **Validate**: `pnpm prisma migrate dev --name billing_invoices` succeeds.

## 2. Pure compute

- [ ] **2.1** Add dep `decimal.js@^10` to `apps/api`.
      **Validate**: install succeeds.

- [ ] **2.2** `apps/api/src/invoices/compute.ts` implements `computeInvoice(input)` per PLAN §3.
      **Validate**: see §3.

- [ ] **2.3** `apps/api/src/invoices/tax-rates.ts`: `pickIvaCode(fecha)`. Refer to `docs/sri-...` for exact codes (codigo `"2"`, codigoPorcentaje `"4"` for 15%; `"2"` for 12%; `"0"` for 0%; `"6"` for "No Objeto").
      **Validate**: unit tests cover fechas: `2024-03-31` → 12%; `2024-04-01` → 15%; `2026-05-19` → 15%.

## 3. Compute tests

- [ ] **3.1** Happy path: one line `cantidad=1, precioUnitario=100, IVA 15%`. Expect `totalSinImpuestos=100.00, totalImpuestos[0].valor=15.00, importeTotal=115.00`.
      **Validate**: pass.

- [ ] **3.2** Multiple lines, mixed IVA codes (15% + 0%); ensure aggregation per `(codigo,codigoPorcentaje)`.
      **Validate**: pass.

- [ ] **3.3** Discount: line with `descuento=10`; recompute base.
      **Validate**: pass.

- [ ] **3.4** Boundary IVA rate: fechaEmision `2024-03-31` and `2024-04-01` chosen correctly.
      **Validate**: pass.

- [ ] **3.5** Property test (vitest + fast-check or seeded random): 100 cases, each with 1–10 lines; assert sum invariants ±0.01.
      **Validate**: pass.

## 4. Endpoints

- [ ] **4.1** `POST /api/v1/invoices` (`invoice.create`):

  - Body validates `CreateInvoiceSchema`.
  - Verify `customerId` belongs to `req.companyId` (or 404).
  - Server fills `fechaEmision` defaulting to today (caller may pass `YYYY-MM-DD`; transform to Date in Ecuador TZ).
  - Computes totals; stores draft with `estado="BORRADOR"`.
    **Validate**: integration test: 201; row exists; cross-tenant customer → 404.

- [ ] **4.2** `PATCH /api/v1/invoices/:id` (`invoice.create`):

  - Only while BORRADOR (`estado !== "EMITIDO"`); else 422 `code:"locked"`.
  - Replaces lines/payments/adicionales (transactional).
  - Recomputes totals.
    **Validate**: edit before emit → 200; edit on EMITIDO → 422.

- [ ] **4.3** `POST /api/v1/invoices/:id/preview-totals` (`invoice.create`):

  - Validates body without persisting; returns the same totals shape as PATCH would store.
    **Validate**: preview matches stored after a follow-up PATCH (byte-identical totals).

- [ ] **4.4** `GET /api/v1/invoices?estado=&from=&to=&q=&limit=20&cursor=` (`invoice.read`):

  - Filters by estado (multi), date range, free-text `q` over customer razonSocial or claveAcceso.
  - Cursor pagination by `(createdAt DESC, id DESC)`.
  - Response validates `InvoiceListResponseSchema`.
    **Validate**: seed 25 invoices; paginate through them in 2 batches.

- [ ] **4.5** `GET /api/v1/invoices/:id` (`invoice.read`):

  - Returns `InvoiceDetailSchema`-shaped body including a mirror of SriDocument estado (mirror field on Invoice; orchestrator updates).
    **Validate**: pass.

- [ ] **4.6** `DELETE /api/v1/invoices/:id` (`invoice.create`):
  - Only BORRADOR.
  - Hard-delete the draft (no business value in soft-deleting drafts) — or soft-delete: choose and document. Recommended: soft-delete with `deletedAt` for audit.
    **Validate**: BORRADOR delete → 204; EMITIDO delete → 422.

## 5. Payment sum guard

- [ ] **5.1** A helper `assertPaymentsMatchTotal(invoice)` checks `|Σ payments.total − importeTotal| ≤ 0.01`. Called by SPEC-0033's emit; **also** exposed via a flag on PATCH response (`paymentsBalanced: boolean`) for UI hints.
      **Validate**: unit test passes for matching and mismatching cases.

## 6. Audit

- [ ] **6.1** Audit `invoice.created|updated|deleted`. Never include line bodies; only `invoiceId`, `companyId`, `actorUserId`.
      **Validate**: rows present after corresponding flows.

## 7. Acceptance criteria

- [ ] AC-1: `computeInvoice` is pure and produces correct totals for the fixture matrix.
- [ ] AC-2: IVA rate switching at 2024-04-01 is verified.
- [ ] AC-3: All money math via decimal.js; no `Number` arithmetic in compute paths.
- [ ] AC-4: Edits forbidden after EMITIDO (422 `code:"locked"`).
- [ ] AC-5: Cursor pagination is stable.
- [ ] AC-6: Property test passes for random inputs.
- [ ] AC-7: Payment sum guard exposed and enforced upstream by SPEC-0033 emit.

## 8. Definition of Done

- All boxes ticked; tests + property test green.
- Review file `ai/reviews/0032-invoice-domain-review.md` written.
