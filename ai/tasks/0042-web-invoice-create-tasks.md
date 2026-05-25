---
id: TASKS-0042
spec: SPEC-0042
plan: PLAN-0042
title: Invoice creation UI — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0042 — Invoice creation UI

> Checklist for [SPEC-0042](../specs/0042-web-invoice-create.md) + [PLAN-0042](../plans/0042-web-invoice-create-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No emoji in UI strings unless requested.
- ❌ No localStorage of drafts; persistence is server-side.
- ❌ No direct `fetch`; use `apiFetch`.
- ❌ No `Number` arithmetic of money; use `parseMoney` + Decimal helpers consistent with the API.
- ✅ Emit button disabled when `paymentsBalanced === false`.
- ✅ All schemas validated via `@facturador/contracts/invoices` on the boundary.

## 1. Routes

- [ ] **1.1** `apps/web/src/routes/invoices.new.tsx`:

  - Renders `<InvoiceForm />` with no `invoiceId`.
  - Wrapped in `<RequirePermission action="invoice.create">`.
    **Validate**: VIEWER navigating → `/forbidden`.

- [ ] **1.2** `apps/web/src/routes/invoices.$id.edit.tsx`:
  - Loads draft via `apiFetch("/api/v1/invoices/:id", { schema: InvoiceDetailSchema })`.
  - If `estado !== "BORRADOR"`: shows "Esta factura ya fue emitida" + link to detail.
  - Else renders `<InvoiceForm invoiceId={id} initial={...} />`.
    **Validate**: test for both branches.

## 2. Form components

- [ ] **2.1** `InvoiceForm` uses `useForm({ resolver: zodResolver(CreateInvoiceSchema) })`.

  - `useFieldArray` for `lines` and `payments`.
  - Top section: punto de emisión (dropdown from `apiFetch("/api/v1/establecimientos")` flattened), fecha (date picker default today, max today).
  - Customer combobox + "Nuevo cliente" button (opens dialog).
  - Lines section with `<LineRow />` rows + "Agregar línea" button. Min 1 line.
  - Payments section with `<PaymentRow />` rows + "Agregar pago" button. Min 1 payment.
  - Adicionales section (optional, up to 15).
  - Totals panel sticky on the right.
  - Buttons: Cancelar, Guardar borrador, Emitir.
    **Validate**: snapshot test; explicit ARIA role/label assertions.

- [ ] **2.2** `LineRow`:

  - Fields: descripcion (text, max 300), cantidad (text inputMode=decimal), precioUnitario (text), descuento (text, default 0), codigoPorcentaje (select with `pickIvaCode(fecha).codigo`).
  - Remove button (disabled if last remaining line).
  - On Enter inside the last input of the last row → add a new line.
    **Validate**: test typing + add line via Enter.

- [ ] **2.3** `PaymentRow`:

  - Fields: formaPago (select from SRI catalog), total (text), plazo (number, optional), unidadTiempo (select, optional).
  - Remove button.
    **Validate**: test.

- [ ] **2.4** `TotalsPanel`:

  - Reads totals from `useDebouncedTotals(invoiceId)` mutation.
  - Shows `Subtotal / IVA / Total` formatted in es-EC currency.
  - Pending spinner inline while mutation in flight; never blocks typing.
  - "Pagos no coinciden con el total" chip when `paymentsBalanced === false`.
    **Validate**: test.

- [ ] **2.5** `CustomerCombobox`:

  - Async search via `apiFetch("/api/v1/customers?q=...", { schema: ... })`.
  - Debounce 250 ms; min 2 chars.
  - On select, set `customerId` in form.
  - "Nuevo cliente" opens `<NewCustomerDialog />`; on success: select newly created customer.
    **Validate**: test with MSW for `?q=` and `POST /customers`.

- [ ] **2.6** `NewCustomerDialog`:

  - Form via RHF + zodResolver(CreateCustomerSchema).
  - On submit: `POST /api/v1/customers`; on success close + select.
    **Validate**: test.

- [ ] **2.7** `EmitModal`:
  - State machine: `idle → submitting → success | business_error | network_error`.
  - success: "Procesando con el SRI…" → "AUTORIZADO" → auto-redirect to `/invoices/:id` after 400 ms.
  - business_error: list mensajes (max 5 visible, "Ver más" expands); "Corregir y reenviar" closes modal.
  - network_error: "Reintentar" button.
  - Cancel disabled during submitting.
    **Validate**: test each branch.

## 3. Hooks

- [ ] **3.1** `useDebouncedTotals(invoiceId)`:

  - Watches the form values (`useWatch`).
  - 250 ms debounce; aborts in-flight on new changes (AbortController).
  - Only fires when `invoiceId` is present.
    **Validate**: test:
  - Typing in cantidad fires exactly one preview after 250 ms.
  - Two rapid changes within 250 ms still fire only one preview after the last change.

- [ ] **3.2** `useAutoSave(invoiceId, dirty)`:

  - Every 30 s, if dirty, PATCH the draft silently and surface a subtle "Borrador guardado" indicator.
  - Cancel timer on unmount.
    **Validate**: test using mock timers; tick 30 s; PATCH called once.

- [ ] **3.3** `useEmitInvoice(invoiceId)`:
  - Mutation calling `POST /api/v1/invoices/:id/emit`.
  - Returns the response.
    **Validate**: test verifies CSRF header on the request.

## 4. Submit flow

- [ ] **4.1** "Guardar borrador" button:

  - Save pending edits (PATCH); navigate to `/invoices` list.
    **Validate**: test.

- [ ] **4.2** "Emitir" button:
  - Disabled if `!isValid` or `!paymentsBalanced`.
  - Opens `EmitModal`; on success (estado AUTORIZADO or EN_PROCESO) navigate to `/invoices/:id`.
  - On business_error keep form; show mensajes.
  - On network_error allow retry.
    **Validate**: integration test for each branch with MSW.

## 5. Acceptance criteria

- [ ] AC-1: Draft created silently on first edit; URL updates to `/invoices/:id/edit`.
- [ ] AC-2: Totals updated in ≤ 500 ms after typing.
- [ ] AC-3: Customer select and create both fill the field.
- [ ] AC-4: Payment mismatch disables Emitir + shows chip.
- [ ] AC-5: Emit success navigates to detail with EMITIDO/AUTORIZADO.
- [ ] AC-6: Emit DEVUELTA shows mensajes; form intact.
- [ ] AC-7: Auto-save fires after 30 s of dirty changes.
- [ ] AC-8: VIEWER cannot open `/invoices/new`.

## 6. Definition of Done

- All boxes ticked; tests + integration green; manual smoke green.
- Review file `ai/reviews/0042-web-invoice-create-review.md` written.
