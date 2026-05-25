---
id: PLAN-0042
spec: SPEC-0042
title: Invoice creation UI — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0042 — Invoice creation UI

> Implementation plan for [SPEC-0042](../specs/0042-web-invoice-create.md). Depends on PLAN-0005/0031/0032/0033/0040/0041.

## 1. Goal

Build the factura form at `/invoices/new` (and `/invoices/:id/edit` while BORRADOR):

- Punto de emisión + fecha + customer (combobox + inline create) + lines + payments + adicionales.
- Live totals (debounced 250 ms) via `POST /invoices/:id/preview-totals` once a draft exists.
- "Guardar borrador" auto-save every 30 s.
- "Emitir" → modal with `submitting | success | business_error | network_error` states; redirects to detail on success/EN_PROCESO.

## 2. Inputs

- [SPEC-0042](../specs/0042-web-invoice-create.md) — authoritative.
- [SPEC-0032](../specs/0032-invoice-domain.md), [SPEC-0033](../specs/0033-invoice-emission-orchestrator.md).
- [SPEC-0005](../specs/0005-shared-contracts.md) — schemas.
- [SPEC-0040](../specs/0040-web-app-bootstrap.md), [SPEC-0041](../specs/0041-web-auth-flows.md) — bootstrap & guards.

## 3. Architecture decisions

| Decision                                                                                                                                                                | Rationale                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Form via React Hook Form + zodResolver(CreateInvoiceSchema).                                                                                                            | One source of truth for shape.    |
| `useFieldArray` for lines and payments.                                                                                                                                 | Standard.                         |
| Numeric inputs are `<input type="text" inputMode="decimal">`; parsing via `parseMoney` helper.                                                                          | Locale-tolerant.                  |
| Live totals: a custom `useDebouncedTotals` hook posts to preview-totals when the form is "stable" (250 ms after last change).                                           | Smooth UX.                        |
| First save creates the draft; URL updates to `/invoices/:id/edit`.                                                                                                      | Refresh-safe.                     |
| Auto-save: every 30 s if dirty → silent PATCH.                                                                                                                          | Recovery if user navigates away.  |
| Customer combobox: async search (debounced 250 ms, min 2 chars). + "Nuevo cliente" opens a modal with `CreateCustomerSchema` form; on success the customer is selected. | UX matches accountants' workflow. |
| Emit modal: portal-rendered; covers screen; cancel disabled during submitting.                                                                                          | Predictable.                      |
| Permission gate: route wrapped in `<RequirePermission action="invoice.create">`.                                                                                        | Server-enforced too.              |
| Keyboard shortcut: Enter at end of last cell adds a new line.                                                                                                           | Cheap and useful.                 |

## 4. Phases

### Phase 1 — Form skeleton

- `apps/web/src/routes/invoices.new.tsx`: hydrates an empty form; on first change creates a draft.
- `apps/web/src/routes/invoices.$id.edit.tsx`: loads existing draft via `GET /invoices/:id`; refuses to edit if `estado !== "BORRADOR"`.

### Phase 2 — Components

- `InvoiceForm`: top-level RHF form provider.
- `LineRow`: row in lines array with inputs + remove button + IVA selector.
- `PaymentRow`: row in payments array.
- `TotalsPanel`: sticky on the right; shows subtotal / IVA / total; pending spinner while preview in-flight.
- `CustomerCombobox`: async-search dropdown.
- `NewCustomerDialog`: modal form.
- `EmitModal`: 4-state modal.

### Phase 3 — Hooks

- `useDebouncedTotals(invoiceId)`: 250 ms debounce; mutation against preview-totals.
- `useAutoSave(invoiceId, dirty)`: 30 s interval; silent PATCH; surfaces "Borrador guardado" toast.

### Phase 4 — Submit

- `useEmitInvoice()`: mutation hook calling `POST /invoices/:id/emit`.
- On `EmitModal` state machine:
  - submitting → success → navigate to `/invoices/:id` after 400 ms.
  - submitting → business_error → expand mensajes; "Corregir y reenviar" returns to form intact.
  - submitting → network_error → "Reintentar" button.

### Phase 5 — Tests

- `LineRow.test.tsx`: editing fields propagates through RHF; remove works.
- `PaymentRow.test.tsx`: same.
- `CustomerCombobox.test.tsx`: async search returns mocked results; selecting fills the field.
- `useDebouncedTotals.test.ts`: changing values triggers exactly one preview after 250 ms.
- `useAutoSave.test.ts`: 30 s mock timer fires PATCH.
- Full-flow integration:
  - Add line cantidad=1 precioUnitario=100 IVA 15% → totals 100/15/115 within 500 ms.
  - Payment off by 0.01 → warning chip + Emitir disabled.
  - Emit success → navigates to detail with `estado === "EMITIDO"`.
  - Emit DEVUELTA → modal shows mensajes; form intact.
- VIEWER tries to open `/invoices/new` → 403 page.

## 5. Risks & mitigations

| Risk                                             | Mitigation                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Debounce thrash when user types fast.            | 250 ms; previous call aborted via AbortController.                    |
| Auto-save fires after route change.              | Cancel on unmount via cleanup.                                        |
| Payment sum rounding issues.                     | Same `parseMoney` + Decimal helper as backend; tolerance ±0.01.       |
| Customer modal causes scroll lock issues.        | Trap focus inside modal; restore focus on close.                      |
| Keyboard shortcut conflicts with screen readers. | Use `Enter` only when focus is inside the last input of the last row. |

## 6. Validation strategy

- All tests + integration pass.
- Manual smoke: fill in a draft, see totals update, emit in stub mode → redirected to detail.

## 7. Exit criteria

- All SPEC-0042 ACs pass.

## 8. Out of scope

- RIDE PDF preview — later.
- Templates / clone — later.
- Bulk import — out.
