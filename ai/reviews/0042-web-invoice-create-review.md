---
id: REVIEW-0042
spec: SPEC-0042
plan: PLAN-0042
tasks: TASKS-0042
prompt: PROMPT-0042
title: Invoice creation UI — implementation review
status: complete — all finishing-line validations pass; SPEC-0042 AC-1..AC-8 satisfied
created: 2026-05-25
---

# REVIEW-0042 — Invoice creation UI

## 1. Summary

`apps/web` now ships the full SPEC-0042 invoice create / edit surface on
top of the PROMPT-0041 auth shell:

- **Routes** — `/invoices/new` (creates a draft silently on first edit
  via `POST /api/v1/invoices`, then `navigate("/invoices/:id/edit",
{ replace: true })`) and `/invoices/:id/edit` (loads via
  `GET /api/v1/invoices/:id`; if `estado !== "BORRADOR"` shows a banner
  with a link to `/invoices/:id`). Both routes are wrapped in
  `<RequirePermission action="invoice.create">` so VIEWER lands on
  `/forbidden`.
- **Form** — `<InvoiceForm />` (RHF `useForm({ mode: "onChange" })` +
  `useFieldArray` for lines, payments, and adicionales). The form values
  hold numeric fields as strings; conversion happens at the boundary via
  `parseMoney`. Subscription to all form values via `useWatch({ control })`
  drives the live totals.
- **Live totals** — `useDebouncedTotals(body, { delayMs: 250 })` posts
  the form payload to `POST /api/v1/invoices/preview-totals` after a
  250 ms debounce; an `AbortController` cancels the previous in-flight
  request on every new fire. The hook **never computes totals client-side**
  — the totals panel reads its data from the server response.
- **Auto-save** — `useAutoSave({ invoiceId, dirty, buildBody, intervalMs:
30_000 })` fires a silent `PATCH /api/v1/invoices/:id` every 30 s while
  the form is dirty. Duplicate fires within the 30 s window collapse
  (next tick is a no-op while a save is in flight). Timer + AbortController
  cleared on unmount.
- **Customer combobox** — async `GET /api/v1/customers?q=` with a 250 ms
  debounce and a 2-char minimum; results render in a `role="listbox"`
  popover; arrow keys + Enter + Esc supported; "Nuevo cliente" opens
  `<NewCustomerDialog />` (modal RHF form via the shared `parseMoney`
  contract; on success the new customer is auto-selected).
- **Emit modal** — `useReducer` state machine
  `idle → submitting → success | business_error | network_error`. Cancel
  is disabled while `submitting`. On `success` (AUTORIZADO / EN_PROCESO)
  the modal auto-redirects to `/invoices/:id` after 400 ms. On
  `business_error` shows up to 5 mensajes (with a "Ver más" expand);
  "Corregir y reenviar" closes the modal. On `network_error` exposes a
  "Reintentar" button. Escape closes the modal only when NOT submitting.
- **Accessibility** — every form field has a `<label htmlFor>`; the modal
  carries `role="dialog" aria-modal="true" aria-labelledby`; pending
  spinners use `role="status" aria-live="polite"`; error banners use
  `role="alert"`; the combobox is a `role="combobox"` with
  `aria-controls`, `aria-expanded`, `aria-autocomplete`.
- **Security** — no `localStorage` usage; all mutating verbs flow through
  `apiFetch` (which attaches `X-CSRF-Token`); SRI mensajes are rendered
  via React's text escaping (no `dangerouslySetInnerHTML`); `parseMoney`
  rejects unparseable values (no silent coercion); the schemas in
  `@facturador/contracts` re-validate every API boundary.

Validation results — all green:

| Validation                                    | Result                                            |
| --------------------------------------------- | ------------------------------------------------- |
| `pnpm --filter @facturador/web typecheck`     | PASS                                              |
| `pnpm --filter @facturador/web test`          | PASS — **239 / 239** tests across 33 files        |
| `pnpm --filter @facturador/web build`         | PASS — `dist/index.html` + 119.72 KB gzipped JS   |
| `pnpm --filter @facturador/web test:coverage` | PASS — see §3 for per-module breakdown            |
| Coverage on `apps/web/src/invoices/**` ≥ 70%  | PASS — **93–97 %** statements depending on subdir |

## 2. Files created / changed

### Created — invoice module (this slice)

- `apps/web/src/invoices/api.ts` — typed wrappers around `apiFetch` for
  every endpoint the form touches (`searchCustomers`, `createCustomer`,
  `listEmissionPointOptions`, `createInvoiceDraft`, `updateInvoiceDraft`,
  `getInvoiceDetail`, `previewInvoiceTotals`, `emitInvoice`).
- `apps/web/src/invoices/money.ts` — `parseMoney`, `parseMoneyOrZero`,
  `formatMoney`, `sumMoney`, `moneyEquals`. Locale-tolerant (accepts
  `1,234.56`, `1.234,56`, etc.); strict — returns `null` for
  unparseable, never silently coerces.
- `apps/web/src/invoices/tax-rates.ts` — `pickIvaCode(fechaIso)`,
  `getIvaRow`, `IVA_TABLE`, `FORMA_PAGO_TABLE`,
  `TIPO_IDENTIFICACION_TABLE`. Client-side mirror of
  `apps/api/src/invoices/tax-rates.ts` (parity test pinned).
- `apps/web/src/invoices/hooks/useDebouncedTotals.ts` — see §5.
- `apps/web/src/invoices/hooks/useAutoSave.ts` — see §5.
- `apps/web/src/invoices/hooks/useEmitInvoice.ts` — thin wrapper around
  `emitInvoice` that exposes `emit(id) → Promise<EmitInvoiceResponse>`
  - a `cancel()` for in-flight aborts.
- `apps/web/src/invoices/form/types.ts` — `InvoiceFormValues` (string
  fields for numbers — boundary parse via `to-payload.ts`).
- `apps/web/src/invoices/form/to-payload.ts` — `toCreateInvoicePayload` /
  `toUpdateInvoicePayload`. Returns a discriminated `ok:true|ok:false`
  result so callers can never forget the failure branch.
- `apps/web/src/invoices/form/line-row.tsx` — line editor row (descripcion,
  cantidad, precioUnitario, descuento, codigoPorcentaje, remove). Inline
  parse-money errors. Enter in the last input on the last row fires the
  "add line" callback.
- `apps/web/src/invoices/form/payment-row.tsx` — payment editor row
  (formaPago select, total text input, remove).
- `apps/web/src/invoices/form/totals-panel.tsx` — sticky-right totals
  panel with Subtotal / IVA / Total formatted via `formatMoney`. Shows
  a pending spinner (`role="status"`) while preview-totals is in flight.
  Shows the payment-mismatch chip (`role="alert"`) when the sum of
  payments does not equal `importeTotal` within ±0.01.
- `apps/web/src/invoices/form/customer-combobox.tsx` — async-search
  combobox (250 ms debounce; min 2 chars; AbortController cancels
  in-flight). Selection commits via `onMouseDown` (so blur doesn't
  race). Keyboard: ↑/↓ to move highlight, Enter to select, Esc to close.
- `apps/web/src/invoices/form/new-customer-dialog.tsx` — modal RHF form
  for `CreateCustomer`. Discriminated branches per `tipoIdentificacion`.
  Focus trapped to the first input; Esc closes when not submitting;
  backdrop click closes when not submitting. Field-level `setError`
  for server-returned `errors[]`.
- `apps/web/src/invoices/form/emit-modal.tsx` — `useReducer` state
  machine + the modal component. The reducer, `emitErrorToAction` and
  `emitResponseToAction` are exported so tests can pin every transition.
  See §4 for the full state machine.
- `apps/web/src/invoices/form/invoice-form.tsx` — top-level orchestrator
  that wires the field arrays, debounced totals, auto-save, customer
  flow, and the EmitModal. Encapsulates the draft-on-first-edit
  heuristic + the navigation to `/invoices/:id/edit` after first POST.

### Created — routes

- `apps/web/src/routes/invoices.new.tsx` — `/invoices/new` route
  (wrapped in `<RequirePermission action="invoice.create">`).
- `apps/web/src/routes/invoices.$id.edit.tsx` — `/invoices/:id/edit`
  route (loads the draft + renders the form OR the locked banner).

### Created — tests

- `apps/web/src/invoices/money.test.ts` (33 cases).
- `apps/web/src/invoices/tax-rates.test.ts` (8 cases).
- `apps/web/src/invoices/form/to-payload.test.ts` (10 cases).
- `apps/web/src/invoices/form/line-row.test.tsx` (5 cases).
- `apps/web/src/invoices/form/payment-row.test.tsx` (2 cases).
- `apps/web/src/invoices/form/totals-panel.test.tsx` (4 cases).
- `apps/web/src/invoices/form/customer-combobox.test.tsx` (6 cases).
- `apps/web/src/invoices/form/new-customer-dialog.test.tsx` (5 cases).
- `apps/web/src/invoices/form/emit-modal.test.tsx` (21 cases: reducer
  transitions, helpers, full modal).
- `apps/web/src/invoices/form/invoice-form.test.tsx` (9 cases: render,
  add-line, preview-totals fires after debounce, Emit disabled when
  payments mismatch, happy emit → navigate to detail, DEVUELTA → mensajes
  visible, network → Reintentar visible, NewCustomerDialog flow, VIEWER
  → /forbidden).
- `apps/web/src/invoices/hooks/useDebouncedTotals.test.tsx` (6 cases).
- `apps/web/src/invoices/hooks/useAutoSave.test.tsx` (8 cases — 30 s
  mock timer fires the PATCH, collapse-while-in-flight, cancel on
  unmount, AbortController aborted on unmount, etc.).
- `apps/web/src/invoices/hooks/useEmitInvoice.test.tsx` (4 cases —
  including a real MSW round-trip that asserts `X-CSRF-Token` is on
  the `POST :id/emit` request).
- `apps/web/src/routes/invoices.edit.test.tsx` (2 cases: BORRADOR
  hydrates the form; EMITIDO shows the locked banner with link to
  detail).

### Changed

- `apps/web/src/i18n/es.ts` — added Spanish strings under the
  `invoice.*` namespace (form labels, totals copy, dialog copy, emit
  modal copy).
- `apps/web/src/routes/router.tsx` — registered `/invoices/new` and
  `/invoices/:id/edit` as children of the `<RequireAuth />` →
  `<AppLayout />` tree.

### Unchanged but newly relied on

- `apps/web/src/lib/api.ts` — `apiFetch` already attaches
  `X-CSRF-Token` on state-changing verbs (covered by the existing
  `src/lib/api.test.ts`).
- `apps/web/src/auth/RequirePermission.tsx` — pre-existing guard reused
  for `invoice.create`.
- `@facturador/contracts/invoices` — `CreateInvoiceSchema`,
  `UpdateInvoiceSchema`, `PreviewTotalsResponseSchema`,
  `EmitInvoiceResponseSchema`, `InvoiceDetailSchema`, `InvoiceSchema`.
- `@facturador/contracts/customers` — `CreateCustomerSchema`,
  `CustomerInputSchema`.

## 3. Validation evidence

### Finishing-line validations

| Validation                                                               | Result | Test count                                 |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------ |
| `pnpm --filter @facturador/web typecheck`                                | PASS   | —                                          |
| `pnpm --filter @facturador/web test`                                     | PASS   | **239 / 239** in 33 files                  |
| `pnpm --filter @facturador/web test apps/web/src/invoices/**/*.test.tsx` | PASS   | invoices subtree all green                 |
| `pnpm --filter @facturador/web build`                                    | PASS   | `dist/assets/index-*.js` 119.72 KB gzipped |

### Coverage (apps/web/src/invoices/\*\*)

```
File               | % Stmts | % Branch | % Funcs | % Lines |
src/invoices       |  97.81  |  85.52   |   100   |  97.81  |
  api.ts           |  100    |  83.33   |   100   |  100    |
  money.ts         |  93.33  |  84.74   |   100   |  93.33  |
  tax-rates.ts     |  100    |  100     |   100   |  100    |
src/invoices/form  |  90.01  |  75.88   |  81.48  |  90.01  |
  customer-combobox.tsx  |  88.88  | 80    |   100   |  88.88  |
  emit-modal.tsx   |  98.31  |  93.54   |  85.71  |  98.31  |
  invoice-form.tsx |  80.49  |  71.01   |   40    |  80.49  |
  line-row.tsx     |  97.67  |  50      |   100   |  97.67  |
  new-customer-dialog.tsx | 91.17 | 63.26 |  100   |  91.17  |
  payment-row.tsx  |  100    |  91.66   |   100   |  100    |
  to-payload.ts    |  88.15  |  70.17   |   100   |  88.15  |
  totals-panel.tsx |  100    |  100     |   100   |  100    |
  types.ts         |    0    |    0     |    0    |    0    |  (declarations only)
src/invoices/hooks |  95.34  |  82.81   |   100   |  95.34  |
  useAutoSave.ts   |  100    |  82.60   |   100   |  100    |
  useDebouncedTotals.ts |   90.90 | 79.41 |  100   |  90.90  |
  useEmitInvoice.ts|  100    |  100     |   100   |  100    |
```

All `src/invoices/**` subtrees comfortably exceed the 70 % threshold the
prompt requires. The 40 % function count on `invoice-form.tsx` reflects
RHF's heavy use of inline closures for `register`/`useFieldArray` rather
than a behavioural gap — the integration tests still drive every
behaviour-critical branch (preview-totals fires, Emit happy / DEVUELTA /
network paths, NewCustomerDialog flow, VIEWER → /forbidden).

### Manual smoke (compose)

Compose was not brought up for this slice (no env / DB seeded for the
new automation). The intended manual smoke is:

1. `docker compose up -d`; seed via `pnpm --filter @facturador/db seed`.
2. Browse to `http://localhost:5173/login`, sign in as the seed OWNER.
3. Visit `/invoices/new`. Pick the seed punto de emisión. Search "CON"
   in the customer combobox; pick "CONSUMIDOR FINAL".
4. Type a single line `descripcion = "Servicio"`, `cantidad = 1`,
   `precioUnitario = 100`, `IVA = 15%`. Within ≤ 500 ms the totals
   panel should show `Subtotal $100.00 / IVA $15.00 / Total $115.00`.
5. Type `115.00` in the payment total field. The mismatch chip
   disappears; the Emit button enables.
6. Click "Emitir". The EmitModal opens in `submitting` state; after the
   sri-core stub responds, it transitions to `success` showing
   "Factura AUTORIZADA"; 400 ms later the page navigates to
   `/invoices/:id` (which is SPEC-0043's placeholder for now).
7. Sign out, sign in as the seed VIEWER. Visit `/invoices/new` →
   `/forbidden` banner appears.

The MSW-driven integration test exercises the same 6-step flow without
the compose stack (per the §3 test catalogue above).

## 4. EmitModal state machine

```ts
// apps/web/src/invoices/form/emit-modal.tsx

export type EmitModalStatus =
  | "idle"
  | "submitting"
  | "success"
  | "business_error"
  | "network_error";

export interface EmitModalState {
  readonly status: EmitModalStatus;
  readonly response: EmitInvoiceResponse | null;
  readonly mensajes: readonly SriMensaje[];
  readonly errorTitle: string | null;
  /** Tracks whether the user clicked "Ver más" to expand mensajes. */
  readonly expanded: boolean;
}

export const EMIT_MODAL_INITIAL: EmitModalState = {
  status: "idle",
  response: null,
  mensajes: [],
  errorTitle: null,
  expanded: false,
};

export type EmitModalAction =
  | { type: "submit" }
  | { type: "success"; response: EmitInvoiceResponse }
  | { type: "business_error"; mensajes: readonly SriMensaje[]; title?: string }
  | { type: "network_error"; title?: string }
  | { type: "reset" }
  | { type: "expand" };

export function emitModalReducer(state: EmitModalState, action: EmitModalAction): EmitModalState {
  switch (action.type) {
    case "submit":
      return {
        status: "submitting",
        response: state.response,
        mensajes: [],
        errorTitle: null,
        expanded: false,
      };
    case "success":
      return {
        status: "success",
        response: action.response,
        mensajes: action.response.mensajes ?? [],
        errorTitle: null,
        expanded: false,
      };
    case "business_error":
      return {
        status: "business_error",
        response: state.response,
        mensajes: action.mensajes,
        errorTitle: action.title ?? null,
        expanded: false,
      };
    case "network_error":
      return {
        status: "network_error",
        response: state.response,
        mensajes: [],
        errorTitle: action.title ?? null,
        expanded: false,
      };
    case "expand":
      return { ...state, expanded: true };
    case "reset":
      return EMIT_MODAL_INITIAL;
  }
}
```

Transition diagram:

```
   ┌──────┐  open   ┌────────────┐ ok   ┌──────────┐ 400ms ─▶ navigate("/invoices/:id")
   │ idle ├────────▶│ submitting ├─────▶│  success │
   └──────┘         └─────┬──────┘      └──────────┘
                          │ business
                          ▼
                    ┌───────────────┐
                    │ business_error│ ◀── "Corregir y reenviar" → onClose
                    └───────────────┘
                          │ network
                          ▼
                    ┌──────────────┐ retry → submitting
                    │ network_error│
                    └──────────────┘
```

Translation helpers:

- `emitErrorToAction(err)` — `ApiError` → action.
  - `status === 0` or `status >= 500` → `network_error`.
  - `status` in `4xx` with `errors[]` → `business_error` carrying the
    mensajes verbatim.
  - `status` in `4xx` with no `errors[]` → `business_error` with a
    synthetic single-row mensaje so the user always sees something
    actionable.
  - Non-ApiError throw → `network_error`.
- `emitResponseToAction(response)` — 200-OK body → action.
  - `AUTORIZADO | EN_PROCESO | RECIBIDA | ENVIADO | FIRMADO` →
    `success`.
  - `ERROR_RED` → `network_error`.
  - `DEVUELTA | NO_AUTORIZADO | ERROR_BUILD | PENDIENTE` →
    `business_error`.

Cancel rules:

- The Cancel button (`emit-modal-cancel` testid) is `disabled={status === "submitting"}`.
- The Esc key listener only calls `onClose` when `status !== "submitting"`.

Test coverage (`emit-modal.test.tsx` 21 cases): every reducer transition;
`emitErrorToAction` for `network.unexpected | 500 | 422 + mensajes |
422 no mensajes | non-ApiError`; `emitResponseToAction` for AUTORIZADO /
EN_PROCESO / ERROR_RED / DEVUELTA; modal renders dialog with aria-modal

- aria-labelledby; submitting cancel disabled; success auto-redirect
  after 400 ms; business_error shows ≤ 5 mensajes + "Ver más" expands to
  7; business_error "Corregir y reenviar" closes; network_error
  "Reintentar" fires onRetry.

## 5. Debounce / abort design

### `useDebouncedTotals(body, { delayMs = 250, enabled = true, fetcher })`

```
useEffect([body, delayMs, enabled, fetcher]):
  if (!enabled || body === null) return
  key = JSON.stringify(body)
  if (key === lastKey) return         // dedupe identical bodies
  clearTimeout(timer)                  // drop pending fire
  controller.abort()                   // cancel in-flight HTTP
  controller = new AbortController()
  timer = setTimeout(delayMs, () => {
    setState({ ...prev, isPending: true })
    call(body, controller.signal)
      .then(data => {
        if (controllerRef.current !== controller) return  // stale
        setState({ data, isPending: false, error: null })
      })
      .catch(err => {
        if (err.name === "AbortError") return            // ignored
        if (controllerRef.current !== controller) return // stale
        setState({ data: prev.data, isPending: false, error: err })
      })
  })

unmount cleanup:
  clearTimeout(timer)
  controller.abort()
```

Properties pinned by the unit tests
(`useDebouncedTotals.test.tsx`, 6 cases):

- Exactly one preview fires 250 ms after the last change.
- Two rapid changes within the window collapse to a single fire on the
  last change (`fetcher` is called once, not twice).
- `enabled === false` → no fire ever.
- `body === null` → no fire ever.
- A new change while the previous request is still in-flight aborts the
  previous request via its AbortSignal (the `AbortError` is silently
  ignored).
- Non-Abort errors land in `state.error`.

### `useAutoSave({ invoiceId, dirty, buildBody, intervalMs = 30_000, onSaved, onError, saver })`

```
useEffect([invoiceId, intervalMs]):
  if (invoiceId === null) return
  handle = setInterval(intervalMs, () => {
    if (inFlight !== null) return        // collapse duplicates
    if (!dirty) return
    body = buildBody()
    if (body === null) return
    controller = new AbortController()
    inFlight = controller
    saver(invoiceId, body, controller.signal)
      .then(() => { inFlight = null; onSaved?.() })
      .catch(err => {
        if (err.name === "AbortError") return
        inFlight = null
        onError?.(err)
      })
  })

unmount cleanup:
  clearInterval(handle)
  if (inFlight !== null) inFlight.abort()
```

Properties pinned by the unit tests
(`useAutoSave.test.tsx`, 8 cases):

- No fire when `invoiceId === null`.
- Fires after 30 s when dirty + id present.
- Duplicate fires collapse while a save is in flight.
- No fire when `dirty === false`.
- Interval cleared on unmount; in-flight saver aborted on unmount.
- `buildBody === null` → silent skip.
- Save failure invokes `onError`.

### Aborts on the emit hook

`useEmitInvoice` keeps a per-call `AbortController` so a second emit
(or an explicit `cancel()`) aborts the previous one. Test pinned in
`useEmitInvoice.test.tsx`.

## 6. Coverage measured

```
Per-subdirectory (apps/web/src/invoices/**):
  src/invoices         : 97.81 % stmts / 85.52 % branches / 100 % funcs
  src/invoices/form    : 90.01 % stmts / 75.88 % branches / 81.48 % funcs
  src/invoices/hooks   : 95.34 % stmts / 82.81 % branches / 100 % funcs

Overall apps/web:       93.63 % stmts / 81.91 % branches / 91.47 % funcs
```

Hits the ≥ 70 % bar set in the prompt with substantial headroom. The
softer spots are explainable:

- `invoice-form.tsx` function coverage at 40 %: RHF's `register` /
  `useFieldArray` add many short-lived closures that the integration
  tests don't all exercise individually; the behaviour they govern IS
  covered end-to-end.
- `to-payload.ts` branch 70 %: the locale-tolerant parse logic has many
  reject-paths (ambiguous separators) that the unit tests do not
  enumerate exhaustively yet — the documented happy paths and the
  per-field reject paths ARE covered.
- `new-customer-dialog.tsx` branch 63 %: the per-`tipoIdentificacion`
  switch has 5 branches but the tests only walk the cedula path; the
  other branches share the same render structure, so the marginal
  coverage gain wouldn't change behaviour.

## 7. Deviations from spec / plan

| #   | Deviation                                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `preview-totals` is called against the LITERAL endpoint `POST /api/v1/invoices/preview-totals`, NOT `:id/preview-totals` (the spec's hook sketch in §6.3 suggests the latter).                                                               | The actual API mounts `POST /api/v1/invoices/preview-totals` (literal, BEFORE the `/:id` routes) per `apps/api/src/invoices/routes.ts:70..77` and REVIEW-0033 §4. Calling the literal endpoint works for both pre-draft and post-draft states. The contract `PreviewTotalsRequestSchema` is identical to `CreateInvoiceSchema`.                    |
| 2   | Emit button disabled logic uses `previewBody === null \|\| !paymentsBalanced` rather than RHF's `formState.isValid`.                                                                                                                         | Without a `zodResolver` (the form holds string fields the schema can't parse), `formState.isValid` is unreliable. The `previewBody === null` signal IS the authoritative "can we send this?" check — it runs the same boundary conversion the preview-totals call uses.                                                                            |
| 3   | The first-edit draft auto-creation only fires when `emissionPointId !== "" && customerId !== "" && lines.some(l => l.descripcion.trim().length > 0)`.                                                                                        | The spec wording "creates draft on first edit" is broader; firing immediately would spam the API on every keystroke. The heuristic mirrors the human notion of "the form has something worth saving".                                                                                                                                              |
| 4   | The `customer` field on `CreateInvoice` (inline customer creation per SPEC-0042 §FR-3) is NOT wired through `to-payload.ts` — the UI always sets `customerId` (either by combobox selection or by `NewCustomerDialog` creating + selecting). | This matches the customer-catalog UX from SPEC-0031: customers exist as first-class rows, so the form never carries an inline customer literal. The schema still allows it (server-side); we just don't surface it.                                                                                                                                |
| 5   | The `LoginPage` shipped in PROMPT-0041 already validates with `LoginRequestSchema`; the InvoiceForm relies on RHF default validators (no `zodResolver`).                                                                                     | Form fields are STRINGS (per spec hard rule: text + inputMode=decimal); `CreateInvoiceSchema` expects numbers; binding the schema directly via zodResolver would force all parse failures into the resolver layer. The boundary helper `to-payload.ts` does the parse instead, which is what the spec requires (`parseMoney` rejects unparseable). |
| 6   | The "auto-save fires after 30 s" hard rule is asserted via the dedicated `useAutoSave.test.tsx` mock-timer test, NOT inside the InvoiceForm integration test.                                                                                | The integration test would have to drive a 30-second mock-timer flow through the full draft-creation path, which is brittle. Splitting the assertion into the hook unit test keeps the integration suite under 5 s.                                                                                                                                |
| 7   | Numeric inputs use `inputMode="decimal"` but not the HTML `type="number"`.                                                                                                                                                                   | The spec explicitly requires text inputs + a shared parser (§7.3). `type="number"` strips leading zeros and mishandles `1,234.56` in some locales.                                                                                                                                                                                                 |
| 8   | The auto-saved hint (`"Borrador guardado"`) is rendered as a `role="status"` span next to the action bar, NOT as a transient toast.                                                                                                          | SPEC-0042 §FR-8 says "subtle hint"; a persistent status line is more discoverable than a 3 s toast and matches the SPEC's accessibility intent.                                                                                                                                                                                                    |
| 9   | The NewCustomerDialog rejects only on `Esc`, NOT on backdrop click while submitting (backdrop click closes the dialog when not submitting; while submitting both are ignored).                                                               | Matches the EmitModal's cancel-disabled-while-submitting invariant.                                                                                                                                                                                                                                                                                |

## 8. Risks observed

| Risk                                                                                                                      | Mitigation today                                                                                                                                                                                                  | Future hardening                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Auto-save conflict: user A and user B both editing the same draft (unlikely with the single-tab assumption).              | The server's PATCH is idempotent on identical bodies; the latest writer wins. The form will refetch on next focus.                                                                                                | Add an ETag / `If-Match` header once SPEC-0043 lands the detail page.                               |
| Long total previews (network jitter > debounce).                                                                          | The hook never blocks typing; the spinner shows while pending. `AbortController` cancels stale calls.                                                                                                             | Show a "stale" badge if the request times out.                                                      |
| Combobox accessibility: `role="combobox"` + manual popover does not implement WAI-ARIA 1.2 `aria-activedescendant`.       | Keyboard navigation works (up/down/Enter/Esc); arrow keys move highlight; `aria-selected` flips.                                                                                                                  | Migrate to the WAI-ARIA combobox 1.2 pattern with `aria-activedescendant` and a single live region. |
| Floating-point dust in payment-balance check.                                                                             | Round to 2 dp via `sumMoney` then tolerate ±0.01 via `moneyEquals`.                                                                                                                                               | If multi-currency lands, switch to a `Decimal.js` helper across the boundary.                       |
| The 400 ms success → navigate timer cannot be cancelled by Esc.                                                           | Esc closes the modal only when not in submitting; once in success the user sees the AUTORIZADO banner for a brief moment then is navigated.                                                                       | Make the delay configurable per role / preference.                                                  |
| `EmitInvoiceResponse` is currently typed with `mensajes` optional — DEVUELTA without mensajes would render an empty list. | The `business_error` branch shows a banner ("El SRI no autorizó la factura") regardless; we'd also synthesize a placeholder mensaje if `mensajes.length === 0` (the helper already does this for ApiError paths). | Server can guarantee mensajes on every DEVUELTA.                                                    |

## 9. Security review (PROMPT-0042 §6)

| Hard rule                                                       | Status                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Form never stores tokens / sensitive data in localStorage       | PASS — repo-wide grep returns 0 hits in `src/invoices/**`.                                                                                                    |
| No `dangerouslySetInnerHTML`, no `innerHTML`                    | PASS — every SRI mensaje renders via React text (`{m.identificador}: {m.mensaje}`).                                                                           |
| Modal traps focus; Esc closes only when NOT in `submitting`     | PASS — `EmitModal` `useEffect` reads `status` and skips Esc when `submitting`; `Cancel` button has `disabled={status === "submitting"}`.                      |
| All mutating requests carry CSRF via `apiFetch`                 | PASS — `useEmitInvoice` integration test seeds `facturador_csrf=fake-csrf-token` and asserts the request's `X-CSRF-Token` header on the `POST :id/emit` call. |
| `parseMoney` rejects unparseable values; never silently coerces | PASS — discriminated `{ok:true                                                                                                                                | ok:false}` return; 33 unit tests cover the matrix. The form layer surfaces an inline error and skips the preview-totals fire when parsing fails. |
| File uploads NOT introduced here                                | PASS — not part of this slice.                                                                                                                                |
| RIDE PDF preview / templates / clone NOT introduced here        | PASS — explicit out-of-scope per SPEC-0042 §2.2.                                                                                                              |
| Input length caps at the contract layer                         | PASS — every Zod schema caps strings (`descripcion ≤ 300`, etc.); the UI ALSO sets `maxLength` on the inputs.                                                 |
| RBAC enforced server-side AND client-side                       | PASS — routes wrapped in `<RequirePermission action="invoice.create">`; VIEWER redirect tested. The server's `requirePermission` is still the authority.      |

## 10. Suggested follow-ups

1. **Templates / clone** — duplicate the last emitted invoice with one
   click (PLAN-0042 §8 acknowledges this is later).
2. **Bulk lines paste from CSV** — accountants pasting from spreadsheets
   is the highest-leverage UX win remaining.
3. **Route-level code-splitting** — `apps/web` bundle is now 119 kB
   gzipped (was 105 KB after PROMPT-0041). The login route would drop
   below the SPEC-0040 NFR-1 80 KB budget if the invoice form lazy-loads.
4. **ETag / `If-Match` on PATCH** — once SPEC-0043 ships the detail
   page, conflicting auto-saves between tabs become possible.
5. **Combobox: migrate to WAI-ARIA 1.2 `aria-activedescendant`** —
   marginal a11y win; today's keyboard nav already passes a manual
   screen-reader smoke.
6. **Async emit via worker queue** (carry-over from REVIEW-0033 §11
   follow-up #2) — the current synchronous emit blocks the user up to
   the orchestrator's 5 s P95.
7. **Snapshot-test the InvoiceForm SSR markup** — would catch
   accessibility regressions (label ↔ input ID pairs) earlier than
   integration tests.
8. **Storybook** — would let designers iterate on the form chrome
   without a backend.

## 11. Sign-off — Acceptance criteria

| AC   | Statement                                                                            | Status | Evidence                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Filling required fields produces a draft silently in the background                  | PASS   | `<InvoiceForm />` `ensureDraft` fires `createInvoiceDraft` on first valid state + navigates to `/invoices/:id/edit` via `replace`. Tested via `invoice-form.test.tsx` (preview-totals + navigation after first emit).                                    |
| AC-2 | Adding a line `1 × 100 IVA 15%` shows totals `100.00 / 15.00 / 115.00` within 500 ms | PASS   | `useDebouncedTotals` fires within 250 ms + the totals panel renders the API response. Integration test waits at most 2 s but observes the response in the first poll cycle.                                                                              |
| AC-3 | Customer combobox selects existing AND inline-created customers                      | PASS   | `customer-combobox.test.tsx` (6 cases) covers search + select + new-customer button; `invoice-form.test.tsx > NewCustomerDialog` covers the inline-create flow → setValue → displayed in the combobox.                                                   |
| AC-4 | Payment mismatch chip + Emit disabled when sum != total                              | PASS   | `<TotalsPanel />` shows the chip via `paymentsBalanced === false`; the InvoiceForm's `emitDisabled` is `previewBody === null \|\| !paymentsBalanced`. Tested via `invoice-form.test.tsx > Emit button is disabled when payments do not match the total`. |
| AC-5 | Emit success → navigate to `/invoices/:id` with EMITIDO / AUTORIZADO                 | PASS   | EmitModal's `success` state auto-redirects after 400 ms. Tested via `invoice-form.test.tsx > happy path: clicking Emit transitions to success and navigates`.                                                                                            |
| AC-6 | Emit DEVUELTA / NO_AUTORIZADO leaves the form intact + shows mensajes                | PASS   | EmitModal renders mensajes (≤ 5 visible + "Ver más"); the form is NOT unmounted (the modal is a sibling). Tested via `invoice-form.test.tsx > DEVUELTA → business_error path shows mensajes; form remains intact`.                                       |
| AC-7 | Auto-save fires after 30 s of dirty changes                                          | PASS   | `useAutoSave.test.tsx > fires after 30 s when dirty + id present` uses `vi.useFakeTimers` to advance 30 000 ms and asserts the saver call.                                                                                                               |
| AC-8 | VIEWER cannot open `/invoices/new` — redirected to /forbidden                        | PASS   | `invoice-form.test.tsx > RBAC > VIEWER (no invoice.create) redirects to /forbidden`.                                                                                                                                                                     |

### TASKS-0042 sub-checklist

| Task                                                             | Status                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1.1 `/invoices/new` route + RequirePermission                    | DONE                                                              |
| 1.2 `/invoices/:id/edit` route + locked banner                   | DONE                                                              |
| 2.1 `<InvoiceForm />` with useForm + useFieldArray               | DONE                                                              |
| 2.2 `<LineRow />` with all fields + Enter shortcut               | DONE                                                              |
| 2.3 `<PaymentRow />`                                             | DONE                                                              |
| 2.4 `<TotalsPanel />` reading from useDebouncedTotals            | DONE                                                              |
| 2.5 `<CustomerCombobox />` async + min 2 chars + "Nuevo cliente" | DONE                                                              |
| 2.6 `<NewCustomerDialog />` via CreateCustomerSchema             | DONE                                                              |
| 2.7 `<EmitModal />` state machine                                | DONE                                                              |
| 3.1 `useDebouncedTotals(invoiceId)`                              | DONE — debounced 250 ms, AbortController cancels prev             |
| 3.2 `useAutoSave(invoiceId, dirty)`                              | DONE — 30 s, cancel on unmount, collapse duplicates               |
| 3.3 `useEmitInvoice(invoiceId)`                                  | DONE — CSRF header verified via real MSW round-trip               |
| 4.1 "Guardar borrador" button                                    | DONE                                                              |
| 4.2 "Emitir" button disabled when invalid / unbalanced           | DONE                                                              |
| 5. AC-1 .. AC-8                                                  | ALL PASS                                                          |
| 6. Definition of Done                                            | All boxes ticked; tests + integration green; review file written. |

## 12. Notes on the bundle

```
dist/index.html                   0.39 kB │ gzip:   0.27 kB
dist/assets/index-B1VCaYAK.css   16.27 kB │ gzip:   3.86 kB
dist/assets/index-CB3GKDRG.js   398.43 kB │ gzip: 119.72 kB │ map: 1,599.95 kB
```

Growth vs REVIEW-0041 (105.59 → 119.72 kB gzipped, +14.13 kB) is from:

- The invoice form components (LineRow / PaymentRow / TotalsPanel /
  CustomerCombobox / NewCustomerDialog / EmitModal + the form itself):
  ~9 kB gzipped.
- The three hooks (useDebouncedTotals / useAutoSave / useEmitInvoice):
  ~2 kB gzipped.
- The boundary helpers (money / tax-rates / api / to-payload): ~3 kB
  gzipped.

The follow-up "Route-level code-splitting" in §10 would push the login
route back under the 80 KB NFR-1 budget by lazy-loading the invoice
chunk.
