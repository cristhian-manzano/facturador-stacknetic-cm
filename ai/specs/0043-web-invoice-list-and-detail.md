---
id: SPEC-0043
title: Invoice list & detail UI
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0005, SPEC-0032, SPEC-0033, SPEC-0040, SPEC-0041, SPEC-0042]
blocks: []
---

# SPEC-0043 — Invoice list & detail UI

## 1. Purpose

Two screens: the invoice list (most-used overview) and the invoice detail page (deep status, SRI events timeline, re-emit actions). Closes the loop on the initial milestone: a user can see what they emitted and respond to SRI outcomes.

## 2. Scope

### 2.1 In scope

- `/invoices` — paginated table with filters and quick search.
- `/invoices/:id` — detail page with header, line items, totals, payment summary, customer block, and an SRI timeline.
- Re-emit action when in `BORRADOR` (post-rejection).
- Reissue action (cloning to a new draft) when an emission is `DEVUELTA`/`NO_AUTORIZADO`.
- Download buttons (placeholders for `signedXml` and `authorizedXml` blobs — actual download wired later when blob serving is implemented).
- Empty state with CTA "Crear factura".

### 2.2 Out of scope

- RIDE PDF download (later spec).
- Export to CSV.
- Anulación at SRI.

## 3. Context & references

- [SPEC-0032](./0032-invoice-domain.md) — invoice estado.
- [SPEC-0026](./0026-document-lifecycle-and-jobs.md) — SRI document lifecycle and events.
- [SPEC-0033](./0033-invoice-emission-orchestrator.md) — emit / reissue.

## 4. Functional requirements

- **FR-1.** `/invoices` list:
  - Columns: Fecha, Cliente, Estab-Pto-Sec, Total, Estado (badge), SRI estado (badge), Acciones.
  - Filters: estado (multi), fecha desde/hasta, búsqueda libre por cliente o claveAcceso.
  - Pagination: cursor (server-side per [SPEC-0032](./0032-invoice-domain.md)).
  - Click row → detail.
  - Refresh button (manual) → invalidates query.
  - Empty state: "Aún no tienes facturas. [Crear factura]".
- **FR-2.** `/invoices/:id` detail:
  - Header: estado, claveAcceso (formatted in groups of 4 for readability), numeroAutorizacion (if any), fechaAutorizacion, ambiente.
  - Customer panel.
  - Lines panel (read-only).
  - Totals panel.
  - Payments panel.
  - **SRI events timeline** — chronological list of `SriEvent` entries with `etapa`, `estado`, `mensajes`, `durationMs`. Errors highlighted in red.
  - Actions (visibility per estado):
    - `BORRADOR` after rejection → "Reintentar emisión" (calls emit again).
    - `BORRADOR` (un-emitted) → "Editar" + "Eliminar".
    - `EMITIDO` (AUTORIZADO) → "Descargar XML autorizado" (placeholder), "Imprimir RIDE" (placeholder).
    - Any → "Reissue como nuevo borrador" if last estado is `DEVUELTA`/`NO_AUTORIZADO`.
  - Polling: when local `estado === EMITIDO && sriEstado === EN_PROCESO`, poll detail every 5 s for up to 5 minutes.

## 5. Non-functional requirements

- **NFR-1.** List loads ≤ 500 ms for the first page (50 rows) on dev hardware.
- **NFR-2.** Detail renders ≤ 400 ms after data is fetched.
- **NFR-3.** Tables remain usable with 10k rows total (cursor pagination ensures responsiveness).

## 6. Technical design

### 6.1 Files

```
apps/web/src/routes/
├── invoices.index.tsx
└── invoices.$id.tsx
apps/web/src/invoices/
├── list/
│   ├── invoices-table.tsx
│   ├── filters-bar.tsx
│   └── estado-badge.tsx
└── detail/
    ├── header.tsx
    ├── lines-panel.tsx
    ├── totals-panel.tsx
    ├── payments-panel.tsx
    ├── customer-panel.tsx
    ├── sri-timeline.tsx
    └── actions-bar.tsx
```

### 6.2 Data shapes (extending contracts)

In `@facturador/contracts/invoices/list.ts` and `detail.ts`:

```ts
export const InvoiceListItemSchema = z.object({
  id: z.string(),
  estado: z.enum(["BORRADOR", "EMITIDO", "ANULADO"]),
  sriEstado: z
    .enum([
      "PENDIENTE",
      "FIRMADO",
      "ENVIADO",
      "RECIBIDA",
      "EN_PROCESO",
      "AUTORIZADO",
      "NO_AUTORIZADO",
      "DEVUELTA",
      "ERROR_RED",
      "ERROR_BUILD",
    ])
    .optional(),
  fechaEmision: z.string(),
  customerRazonSocial: z.string(),
  estab: z.string(),
  ptoEmi: z.string(),
  secuencial: z.string().optional(),
  claveAcceso: z.string().optional(),
  importeTotal: z.number(),
});

export const InvoiceListResponseSchema = z.object({
  items: z.array(InvoiceListItemSchema),
  nextCursor: z.string().nullable(),
});
```

`InvoiceDetailSchema` aggregates the invoice + lines + payments + adicionales + customer + the linked `SriDocument` (estado, numeroAutorizacion, fechaAutorizacion) + ordered `SriEvent[]`.

The API needs new endpoint shapes:

```
GET /api/v1/invoices                   -> InvoiceListResponse
GET /api/v1/invoices/:id               -> InvoiceDetailResponse
```

The detail handler **joins** with SRI Core via `GET /v1/documents/:claveAcceso/status` (proxied), or — preferred for performance — keeps a denormalised cache in the `Invoice` table updated by the orchestrator on emit and refreshed on detail-page poll.

### 6.3 List page

- Table component lazy-loaded.
- Filters bar persists state in URL search params (so refresh keeps state).
- Cursor-based "Cargar más" button (preferred over endless scroll for accountants' use cases).

### 6.4 Detail page

- Polling using TanStack Query `refetchInterval` when `sriEstado in (EN_PROCESO, RECIBIDA, ERROR_RED)`; stops once terminal state reached.
- Timeline component uses semantic `<ol>` with ARIA labels for screen readers.
- Spanish dates rendered via `Intl.DateTimeFormat("es-EC")`.

### 6.5 Permission gating

- `RequirePermission action="invoice.read"` for both routes.
- Action buttons in detail gated per action (`invoice.create` for reissue/retry).

## 7. Implementation guide

### 7.1 Steps

1. Implement the list endpoint + detail endpoint per §6.2 if not yet present (add to [SPEC-0032](./0032-invoice-domain.md) implementation work; spec already lists these).
2. Implement UI files in §6.1.
3. Tests:
   - List renders rows, filters update URL.
   - Detail renders SRI timeline ordered by `createdAt`.
   - EN_PROCESO row polls and transitions to AUTORIZADO when MSW switches the response.
   - Reissue action calls the API and navigates to the new draft.

### 7.2 Dependencies

(None new.)

### 7.3 Conventions

- Tables: keyboard-accessible (arrow keys to navigate rows is **not** required for v1; just standard tab order + visible focus).
- Polling intervals are constants in `apps/web/src/invoices/detail/polling.ts`.
- Empty/error states are first-class components (`<EmptyState />`, `<ErrorState />`).

## 8. Acceptance criteria

- **AC-1.** Empty tenant sees an empty state with a "Crear factura" CTA that routes to `/invoices/new`.
- **AC-2.** After seeding 10 invoices, the list shows 10 rows with correct estados.
- **AC-3.** Filtering by estado `EMITIDO` calls the API with `?estado=EMITIDO` and refreshes the table.
- **AC-4.** Detail page shows the SRI timeline with one entry per `SriEvent`, sorted ascending.
- **AC-5.** An EN_PROCESO invoice that becomes AUTORIZADO during a poll updates the UI without a manual refresh.
- **AC-6.** Reissue from a `DEVUELTA` invoice opens the new draft in `/invoices/:newId/edit`.
- **AC-7.** A `VIEWER` does not see "Reintentar" / "Reissue" buttons (UI gating); API also enforces.

## 9. Test plan

- MSW + Testing Library for each AC.
- Manual: `Lighthouse` accessibility audit on list and detail.

## 10. Security considerations

- Display only fields the API returns; do not render raw HTML.
- ClaveAcceso is shown in full; copying it to clipboard uses `navigator.clipboard.writeText`.
- Sensitive customer data: no email/telefono in tooltips on the list (only on detail).

## 11. Observability

- Front-end logs only navigation and error events to console; no business data.

## 12. Risks and mitigations

| Risk                                              | Mitigation                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polling thrashes server when many EN_PROCESO docs | Single detail page only polls itself; list does not poll.                                                                                             |
| Out-of-date SRI estado vs server                  | "Sincronizar con SRI" button on detail calls the proxy `POST /v1/documents/:claveAcceso/refresh` (added to SRI Core if needed) and updates the cache. |

## 13. Open questions

- Should the list page show a banner aggregating "X facturas pendientes de autorización" with a one-click "Refrescar todas"? Yes; cheap and very useful. Implement.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
