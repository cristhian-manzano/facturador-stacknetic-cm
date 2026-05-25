---
id: PLAN-0043
spec: SPEC-0043
title: Invoice list & detail UI — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0043 — Invoice list & detail UI

> Implementation plan for [SPEC-0043](../specs/0043-web-invoice-list-and-detail.md). Depends on PLAN-0032/0033/0040/0041/0042.

## 1. Goal

Two routes:

- `/invoices` — paginated table with filters + search.
- `/invoices/:id` — detail with header, customer/lines/payments panels, SRI events timeline, actions per estado, and 5-minute polling on EN_PROCESO.

## 2. Inputs

- [SPEC-0043](../specs/0043-web-invoice-list-and-detail.md) — authoritative.
- [SPEC-0032](../specs/0032-invoice-domain.md), [SPEC-0033](../specs/0033-invoice-emission-orchestrator.md).
- [SPEC-0040](../specs/0040-web-app-bootstrap.md), [SPEC-0041](../specs/0041-web-auth-flows.md).

## 3. Architecture decisions

| Decision                                                                                                                                                                                                    | Rationale                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| List uses cursor pagination via "Cargar más" button (no infinite scroll).                                                                                                                                   | Accountants prefer explicit control. |
| Filter state lives in URL search params.                                                                                                                                                                    | Refresh-safe; shareable.             |
| Refresh button calls `queryClient.invalidateQueries(["invoices","list"])`.                                                                                                                                  | Predictable.                         |
| Detail polls every 5 s when `sriEstado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}`, for up to 5 minutes; then stops.                                                                                               | Bounded polling.                     |
| Status badges driven by a tiny table; estado vs sriEstado styled differently.                                                                                                                               | Visual clarity.                      |
| Actions visible per estado/role: Reintentar emisión (BORRADOR after rejection), Editar/Eliminar (BORRADOR), Descargar XML (EMITIDO+AUTORIZADO; placeholder for now), Reissue (when DEVUELTA/NO_AUTORIZADO). | Mirrors business state.              |
| SRI timeline uses `<ol>` with ARIA labels; errors highlighted red.                                                                                                                                          | Accessibility.                       |
| ClaveAcceso formatted in groups of 4 with "copy" button via `navigator.clipboard`.                                                                                                                          | UX.                                  |

## 4. Phases

### Phase 1 — List page

`apps/web/src/routes/invoices.index.tsx`:

- Wrapped in `<RequirePermission action="invoice.read">`.
- Reads filters from URL.
- Calls `apiFetch("/api/v1/invoices?…", { schema: InvoiceListResponseSchema })`.
- Renders `<InvoicesTable />`, `<FiltersBar />`, `<EmptyState />`.

`<FiltersBar />`:

- Estado multi-select; date range (from/to); free-text q.
- Changes update URL (replace).

`<InvoicesTable />`:

- Columns per spec.
- Click row → `/invoices/:id`.
- "Cargar más" button when `nextCursor != null`.

### Phase 2 — Detail page

`apps/web/src/routes/invoices.$id.tsx`:

- `<RequirePermission action="invoice.read">`.
- Loads via `apiFetch("/api/v1/invoices/:id", { schema: InvoiceDetailSchema })`.
- Polls every 5 s when `sriEstado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}` until terminal or 5 minutes elapsed.
- Renders: `<Header />`, `<CustomerPanel />`, `<LinesPanel />`, `<TotalsPanel />`, `<PaymentsPanel />`, `<SriTimeline />`, `<ActionsBar />`.

### Phase 3 — Actions

- "Reintentar emisión" (only when `estado="BORRADOR"` after rejection): POST `/api/v1/invoices/:id/emit`.
- "Editar" / "Eliminar" (only BORRADOR & not emitted): same actions as SPEC-0042 / DELETE.
- "Descargar XML autorizado" / "Imprimir RIDE": placeholders (later spec).
- "Reissue como nuevo borrador": POST `/api/v1/invoices/:id/reissue` → navigate to `/invoices/:newId/edit`.
- "Sincronizar con SRI": POST `/api/v1/invoices/:id/refresh` (per SPEC-0033).

### Phase 4 — Pending banner

A list-page banner aggregating "X facturas pendientes de autorización" with a button "Refrescar todas" → kicks off a batch refresh (calls `refresh` per id with a small concurrency limit).

### Phase 5 — Tests

- `invoices.index.test.tsx`:
  - Empty state with "Crear factura" CTA → navigates to `/invoices/new`.
  - 10 rows seeded → list shows 10.
  - Filter estado=EMITIDO → URL contains `?estado=EMITIDO`; API called with that query.
- `invoices.$id.test.tsx`:
  - Detail shows timeline with one item per `SriEvent`, sorted ascending by `createdAt`.
  - EN_PROCESO with MSW switching to AUTORIZADO → UI auto-updates after a polling tick.
  - Reissue navigates to `/invoices/:newId/edit`.
  - VIEWER cannot see Reintentar / Reissue.

## 5. Risks & mitigations

| Risk                                   | Mitigation                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Polling drains battery / wakes server. | Strict bounds: only specific sriEstado, 5 s interval, 5-min cap; stop on terminal. |
| URL/state desync.                      | Single source of truth: URL → controlled inputs.                                   |
| Large lists slow.                      | Cursor pagination; no client-side sorting beyond the current page.                 |
| Stale data after emit elsewhere.       | Refresh button + invalidate on focus is OFF (user clicks Refresh).                 |

## 6. Validation strategy

- All listed tests pass.
- Manual smoke: filter applied → URL updates; polling test transitions via MSW.

## 7. Exit criteria

- All SPEC-0043 ACs pass.

## 8. Out of scope

- RIDE PDF download — later.
- Export to CSV — later.
- Anulación at SRI — later.
