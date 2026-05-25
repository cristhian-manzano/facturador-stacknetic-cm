---
id: SPEC-0042
title: Invoice creation UI
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0005, SPEC-0031, SPEC-0032, SPEC-0033, SPEC-0040, SPEC-0041]
blocks: [SPEC-0043]
---

# SPEC-0042 — Invoice creation UI

## 1. Purpose

The screen the user spends most of their time on: build a factura, see totals update live, choose / create the customer, choose payments, and emit. On success, the user is taken to the invoice detail page ([SPEC-0043](./0043-web-invoice-list-and-detail.md)) with the SRI state visible.

## 2. Scope

### 2.1 In scope

- Route `/invoices/new` (also `/invoices/:id/edit` while `BORRADOR`).
- Form fields: emission point, customer (pick or inline create), date, lines, payments, optional adicionales.
- Live totals (debounced 250 ms) using `POST /api/v1/invoices/:id/preview-totals`.
- "Guardar borrador" and "Emitir" actions.
- After emit: full-screen status modal ("Enviando al SRI…") then redirect to detail page with the resulting estado.

### 2.2 Out of scope

- RIDE PDF preview.
- Templates / quick clone — later.

## 3. Context & references

- [SPEC-0032](./0032-invoice-domain.md) — domain rules and totals.
- [SPEC-0033](./0033-invoice-emission-orchestrator.md) — emit endpoint.
- [SPEC-0041](./0041-web-auth-flows.md) — permission `invoice.create`.

## 4. Functional requirements

- **FR-1.** Layout (single page, sticky right-side totals panel):

  ```
  ┌─────────────────────────────────────────────┐
  │ [Punto emisión ▾]   [Fecha 📅]              │
  │ Cliente: [Buscar… ▾] [+ Nuevo cliente]      │
  ├─────────────────────────────────────────────┤
  │  Líneas                            [+]      │
  │  ┌────────────────────────────────────┐     │
  │  │ Descripción · Cant · PU · Desc · % │ ✕   │
  │  └────────────────────────────────────┘     │
  │  ...                                        │
  ├─────────────────────────────────────────────┤
  │  Forma de pago [▾]  Total $______           │
  ├─────────────────────────────────────────────┤
  │ [Cancelar]               [Guardar borrador] │
  │                            [Emitir ✓]       │
  └─────────────────────────────────────────────┘
                ┌─────────────────────────────┐
                │ Subtotal: $___              │
                │ IVA 15%: $___                │
                │ Total:    $___              │
                └─────────────────────────────┘
  ```

- **FR-2.** Form library: `react-hook-form` with `zodResolver(CreateInvoiceSchema)`. `useFieldArray` for lines and payments.
- **FR-3.** Customer selector:
  - Async combobox: types ≥ 2 chars → debounced `GET /api/v1/customers?q=`.
  - Selecting an item sets `customerId`.
  - "Nuevo cliente" opens a modal with the `CreateCustomerSchema` form; on success the new customer is selected.
- **FR-4.** Lines: minimum 1; each row validates inline (cantidad > 0, precioUnitario ≥ 0, descripción required ≤ 300 chars). IVA `codigoPorcentaje` defaults based on company config (15% for any fecha ≥ 2024-04-01, 12% otherwise).
- **FR-5.** Live totals: on any debounced change, save a draft (`PATCH` if it has an `id`, `POST` to create otherwise) and POST to `preview-totals`; render `totalSinImpuestos`, `totalConImpuestos`, `importeTotal`. Show a spinner while pending; **do not block** typing.
- **FR-6.** Payments: at minimum one row; total of payments must equal `importeTotal` — show a warning chip until it matches.
- **FR-7.** Submit "Emitir":
  - Saves any pending edits.
  - `POST /api/v1/invoices/:id/emit`.
  - Shows a modal "Procesando con el SRI…" with a progress hint and cancel-disabled.
  - On `AUTORIZADO` or `EN_PROCESO` → redirect to detail.
  - On `DEVUELTA`/`NO_AUTORIZADO` → modal expands to show mensajes and offers "Corregir y reenviar" (returns to the form with the BORRADOR intact).
  - On `sri.network` → modal offers "Reintentar" with the same draft.
- **FR-8.** Auto-save: every 30 s while the form is dirty (silent PATCH); shows a "Borrador guardado" subtle hint.

## 5. Non-functional requirements

- **NFR-1.** Time to interactive on `/invoices/new` ≤ 2 s on dev hardware.
- **NFR-2.** Preview totals round-trip ≤ 200 ms locally.
- **NFR-3.** Form remains responsive while preview is in-flight.

## 6. Technical design

### 6.1 Files

```
apps/web/src/routes/invoices.new.tsx
apps/web/src/routes/invoices.$id.edit.tsx     # uses the same InvoiceForm with existing id
apps/web/src/invoices/
├── form/
│   ├── invoice-form.tsx              # main form (RHF)
│   ├── line-row.tsx
│   ├── payment-row.tsx
│   ├── totals-panel.tsx
│   ├── customer-combobox.tsx
│   ├── new-customer-dialog.tsx
│   └── emit-modal.tsx
├── api.ts                            # createDraft, updateDraft, previewTotals, emit
└── tax-rate-helpers.ts               # pickIvaCode(fecha)
```

### 6.2 API hooks (TanStack Query)

```ts
// useCreateDraft, useUpdateDraft, usePreviewTotals (mutation), useEmitInvoice (mutation)
export const usePreviewTotals = (id: string | null) =>
  useMutation({
    mutationFn: (payload: CreateInvoice) =>
      id
        ? apiFetch<PreviewTotalsResponse>(`/api/v1/invoices/${id}/preview-totals`, {
            method: "POST",
            json: payload,
          })
        : Promise.reject(new Error("no draft id")),
  });
```

### 6.3 Debounced preview hook

```ts
// useDebouncedTotals.ts
import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { usePreviewTotals } from "./api";

export const useDebouncedTotals = (invoiceId: string | null, delayMs = 250) => {
  const { getValues } = useFormContext();
  const watched = useWatch();
  const mutation = usePreviewTotals(invoiceId);
  useEffect(() => {
    if (!invoiceId) return;
    const handle = setTimeout(() => mutation.mutate(getValues() as any), delayMs);
    return () => clearTimeout(handle);
  }, [watched, invoiceId]);
  return mutation;
};
```

### 6.4 Permission gate

The route is wrapped in `<RequirePermission action="invoice.create">` (a thin component reading `useAuth()` and `can(role, action)`). UI hides controls accordingly.

### 6.5 Emit modal lifecycle

- Open with state `submitting`.
- On success transitions to `success` and auto-redirects after 400 ms.
- On business failure transitions to `business_error` showing mensajes (max 5 visible, "Ver más" expands).
- On network failure transitions to `network_error` with a retry button.

### 6.6 Validation UX

- Inline field errors below each input.
- A persistent banner at the top summarises blocking issues ("Faltan: 2 campos", clicking jumps to the first invalid field).
- Submit disabled when there are validation errors.

## 7. Implementation guide

### 7.1 Steps

1. Implement files in §6.
2. Wire route `/invoices/new` and `/invoices/:id/edit`.
3. Tests:
   - Form renders with 1 line by default; adding a line works.
   - Totals update after typing (mock preview endpoint to return deterministic numbers).
   - Payment total mismatch shows a chip and disables Emitir.
   - Emit success redirects to detail (assert navigation).
   - Emit DEVUELTA shows mensajes in modal.

### 7.2 Dependencies

- `react-hook-form` (already), `@hookform/resolvers` (already), `clsx`/`cn` helper (already).
- No new heavy dependency.

### 7.3 Conventions

- All numeric inputs are `<input type="text" inputMode="decimal">` for consistent UX across locales; the form layer parses to number before submit (with a small `parseMoney` helper).
- Spanish copy in `i18n/es.ts`.
- The form always has an `id` after the first save; URL updates to `/invoices/:id/edit` so refresh keeps the draft.

## 8. Acceptance criteria

- **AC-1.** Filling required fields produces a draft (`POST` then `PATCH` on edits) silently in the background.
- **AC-2.** Adding a line with `cantidad=1, precioUnitario=100, IVA 15%` shows totals `100.00 / 15.00 / 115.00` in the totals panel within 500 ms.
- **AC-3.** Selecting an existing customer fills the customer chip; creating a new customer via the dialog also fills it.
- **AC-4.** Setting payments to `114.99` while total is `115.00` shows "Pagos no coinciden con el total" and disables Emitir.
- **AC-5.** Emit success leads to `/invoices/:id` with `estado === EMITIDO`.
- **AC-6.** Emit DEVUELTA leaves the form intact and shows mensajes in the modal.
- **AC-7.** Auto-save fires after 30 s of idle changes (assert via mock timer).
- **AC-8.** A `VIEWER` cannot open `/invoices/new` — redirected to a 403 page.

## 9. Test plan

- Component tests for `LineRow`, `PaymentRow`, `CustomerCombobox`.
- Integration test for the full flow with MSW returning canned API responses.

## 10. Security considerations

- All input length-capped at the contract layer (Zod). UI also caps with `maxLength`.
- No raw HTML rendering of API content.
- The modal that surfaces SRI mensajes escapes any text — no `innerHTML`.

## 11. Observability

- Front-end errors caught by ErrorBoundary; SRI failures surfaced to the user as actionable messages.

## 12. Risks and mitigations

| Risk                                   | Mitigation                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Network blip mid-emit                  | The orchestrator is idempotent (per [SPEC-0033](./0033-invoice-emission-orchestrator.md)); retry is safe. |
| User edits stale draft after returning | TanStack Query refetch on focus disabled; user can manually refresh.                                      |

## 13. Open questions

- Bulk discount on a line? Out of scope for milestone; add later.
- Keyboard shortcut to add a line (`Enter` at end of last cell)? Yes — implement; cheap and useful.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
