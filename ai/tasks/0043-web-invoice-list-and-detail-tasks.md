---
id: TASKS-0043
spec: SPEC-0043
plan: PLAN-0043
title: Invoice list & detail UI — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0043 — Invoice list & detail UI

> Checklist for [SPEC-0043](../specs/0043-web-invoice-list-and-detail.md) + [PLAN-0043](../plans/0043-web-invoice-list-and-detail-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Polling intervals MUST be defined as constants in `apps/web/src/invoices/detail/polling.ts`; never inline.
- ❌ Never render API content as raw HTML.
- ❌ Never show emails / teléfonos on the list view (only on detail).
- ❌ Never display fields the API didn't return.
- ✅ List filter state always reflected in URL.
- ✅ Polling bounded by both interval (5 s) and cap (5 min).

## 1. List page

- [ ] **1.1** `apps/web/src/routes/invoices.index.tsx`:

  - Wrapped in `<RequirePermission action="invoice.read">`.
  - Reads `estado`, `from`, `to`, `q`, `cursor` from URL.
  - `useQuery({ queryKey:["invoices","list",params], queryFn: () => apiFetch("/api/v1/invoices?…", { schema: InvoiceListResponseSchema }) })`.
  - Empty state with "Crear factura" CTA → `/invoices/new`.
  - "Cargar más" button when `nextCursor != null`.
  - Manual "Refrescar" button → `queryClient.invalidateQueries(["invoices","list"])`.
    **Validate**: see §5.

- [ ] **1.2** `<FiltersBar />` updates URL on each change (using `useSearchParams`).
      **Validate**: typing in `q` updates `?q=`.

- [ ] **1.3** `<InvoicesTable />` columns: Fecha, Cliente, Estab-Pto-Sec, Total, Estado (badge), SRI estado (badge), Acciones.
      **Validate**: snapshot test of header row.

- [ ] **1.4** Pending banner: shows count when there are pendings; clicking "Refrescar todas" calls refresh per row with concurrency 3.
      **Validate**: test mocks 3 pendings, clicks the button, asserts 3 refresh calls (sequencing OK).

## 2. Detail page

- [ ] **2.1** `apps/web/src/routes/invoices.$id.tsx`:

  - Loads via `apiFetch("/api/v1/invoices/:id", { schema: InvoiceDetailSchema })`.
  - Header shows estado, claveAcceso (groups of 4 + copy button), numeroAutorizacion, fechaAutorizacion, ambiente badge.
  - Polling: `refetchInterval` of 5 s when `sriEstado ∈ {EN_PROCESO,RECIBIDA,ERROR_RED}`; absolute cap 5 minutes (after which `refetchInterval` returns false).
    **Validate**: see §5.

- [ ] **2.2** `<CustomerPanel />`, `<LinesPanel />`, `<TotalsPanel />`, `<PaymentsPanel />` — read-only.
      **Validate**: snapshot tests.

- [ ] **2.3** `<SriTimeline />`:

  - `<ol>` of events sorted by `createdAt` ascending.
  - Each item shows etapa, estado, mensajes (if any; errors styled red), durationMs.
  - ARIA: `<ol aria-label="Eventos SRI">`.
    **Validate**: test renders 4 events in order.

- [ ] **2.4** `<ActionsBar />`:
  - "Reintentar emisión" visible only when `estado === "BORRADOR"` AND a prior failure exists (e.g., `sriEstado === "DEVUELTA"` or `"NO_AUTORIZADO"` on a previous attempt — model in the detail response).
  - "Editar"/"Eliminar" only when `estado === "BORRADOR"`.
  - "Descargar XML autorizado" and "Imprimir RIDE" visible when `sriEstado === "AUTORIZADO"` (placeholders for v1; buttons show toast "Próximamente").
  - "Reissue como nuevo borrador" when `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}`. Calls `/reissue`; navigates.
  - "Sincronizar con SRI" calls `/refresh`.
  - All action buttons gated by `useAuth().permissions` (`invoice.create`, `invoice.emit`, `invoice.reissue` per action).
    **Validate**: VIEWER does NOT see Reintentar/Reissue; OPERATOR sees Reintentar but not Reissue; ACCOUNTANT sees Reissue.

## 3. Polling constants

- [ ] **3.1** `apps/web/src/invoices/detail/polling.ts`:
  ```ts
  export const POLL_INTERVAL_MS = 5_000;
  export const POLL_MAX_DURATION_MS = 5 * 60_000;
  export const POLLABLE_SRI_ESTADOS = ["EN_PROCESO", "RECIBIDA", "ERROR_RED"] as const;
  ```
  **Validate**: tests import these constants; no magic numbers in the detail file.

## 4. ClaveAcceso copy helper

- [ ] **4.1** `<ClaveAccesoChip />` formats the 49-digit string into groups of 4 and exposes a copy-to-clipboard button using `navigator.clipboard.writeText`.
      **Validate**: test simulates click; asserts clipboard write was called with the raw value.

## 5. Tests

- [ ] **5.1** `invoices.index.test.tsx`:

  - Empty list → empty state with CTA navigates to `/invoices/new`.
  - 10 invoices → 10 rows; estado badges match.
  - Selecting estado=EMITIDO updates URL `?estado=EMITIDO`; API called with same query (MSW assertion on request URL).
  - "Cargar más" appends second page.
    **Validate**: pass.

- [ ] **5.2** `invoices.$id.test.tsx`:
  - Renders timeline ordered by `createdAt`.
  - EN_PROCESO with MSW switching to AUTORIZADO after 5 s → UI transitions without manual refresh.
  - Reissue button click → POST `/reissue` → navigate to `/invoices/:newId/edit`.
  - VIEWER role: Reintentar/Reissue not present in DOM.
    **Validate**: pass.

## 6. Acceptance criteria

- [ ] AC-1: Empty tenant shows empty state with CTA → `/invoices/new`.
- [ ] AC-2: 10 invoices show 10 rows.
- [ ] AC-3: Filter `estado=EMITIDO` updates URL + API call.
- [ ] AC-4: Detail timeline ordered ascending.
- [ ] AC-5: EN_PROCESO → AUTORIZADO updates UI without manual refresh.
- [ ] AC-6: Reissue navigates to new draft.
- [ ] AC-7: VIEWER lacks Reintentar/Reissue (UI gating); API enforces too.

## 7. Definition of Done

- All boxes ticked; tests green; manual smoke green.
- Review file `ai/reviews/0043-web-invoice-list-and-detail-review.md` written.
