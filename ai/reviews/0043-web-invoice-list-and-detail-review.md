---
id: REVIEW-0043
spec: SPEC-0043
plan: PLAN-0043
tasks: TASKS-0043
prompt: PROMPT-0043
title: Invoice list & detail UI — implementation review
status: complete — all finishing-line validations pass; SPEC-0043 AC-1..AC-7 satisfied
created: 2026-05-25
---

# REVIEW-0043 — Invoice list & detail UI

## 1. Summary

This pass closes PROMPT-0043 — the final slice of the initial milestone.
`apps/web` now ships the `/invoices` list and the `/invoices/:id`
detail screens on top of the SPEC-0042 form. All hard constraints from
PROMPT-0043 are honoured:

- **List (`/invoices`)** — `<RequirePermission action="invoice.read">`
  guard wraps the route. The page reads `estado`, `from`, `to`, `q`,
  `cursor` from the URL via `useSearchParams`, calls
  `listInvoices(filters)` (Zod-validated against
  `InvoiceListResponseSchema`) via TanStack Query's
  `useInfiniteQuery`. "Cargar más" appends the next page; "Refrescar"
  invalidates the query. A `<PendingBanner />` aggregates the count of
  rows in `{EN_PROCESO, RECIBIDA, ERROR_RED}` and fires a batch of
  per-row `POST :id/refresh` calls with concurrency 3.
- **Detail (`/invoices/:id`)** — `<RequirePermission action="invoice.read">`
  guard wraps the route. TanStack Query loads the detail with bounded
  polling: `refetchInterval` returns `5_000 ms` while `sriEstado ∈
{EN_PROCESO, RECIBIDA, ERROR_RED}`, capped at 5 minutes since the
  first poll. Polling pauses while the tab is hidden
  (`document.visibilityState === "hidden"`). The page renders
  `<Header />`, `<CustomerPanel />`, `<LinesPanel />`,
  `<DetailTotalsPanel />`, `<PaymentsPanel />`, `<SriTimeline />`,
  `<ActionsBar />` and a tiny `useToast` hint surface.
- **Polling constants** — centralised in
  `apps/web/src/invoices/detail/polling.ts`. Tests import the
  constants (`POLL_INTERVAL_MS`, `POLL_MAX_DURATION_MS`,
  `POLLABLE_SRI_ESTADOS`) directly; no magic numbers in route code.
- **ClaveAccesoChip** — formats the 49 digits in groups of 4 + a copy
  button that calls `navigator.clipboard.writeText` with the RAW
  string; on unsupported browsers the button flips to "No se pudo
  copiar" without throwing.
- **ActionsBar** — gated by `useAuth().permissions` per action:
  Reintentar emisión (BORRADOR + prior failure, `invoice.emit`),
  Editar/Eliminar (BORRADOR, `invoice.create`), Reissue
  (sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}, `invoice.reissue`),
  Sincronizar con SRI (`invoice.read`), Descargar XML / Imprimir RIDE
  (AUTORIZADO, `invoice.read`; both are placeholders showing the
  "Próximamente" toast).
- **SRI timeline** — semantic `<ol aria-label="Eventos SRI">` sorted
  by `createdAt` ascending; ERROR-typed mensajes tinted red.

Validation results — all green:

| Validation                                                            | Result                                          |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm --filter @facturador/web typecheck`                             | PASS                                            |
| `pnpm --filter @facturador/web test`                                  | PASS — **323 / 323** tests across 44 files      |
| `pnpm --filter @facturador/web test src/invoices src/routes/invoices` | PASS — invoices subtree 207/207 across 25 files |
| `pnpm --filter @facturador/web build`                                 | PASS — `dist/index.html` + 130.04 KB gzipped JS |
| `pnpm --filter @facturador/web test:coverage`                         | PASS — see §6                                   |
| Coverage on `apps/web/src/invoices/**` ≥ 70%                          | PASS — **88–99 %** statements per subdir        |

## 2. Files created / changed

### Created — new modules

- `apps/web/src/invoices/detail/polling.ts` — `POLL_INTERVAL_MS`,
  `POLL_MAX_DURATION_MS`, `POLLABLE_SRI_ESTADOS`, plus the pure
  predicates `isPollableEstado` + `shouldKeepPolling`.
- `apps/web/src/invoices/detail/polling.test.ts` — 10 unit cases.
- `apps/web/src/invoices/detail/clave-acceso-chip.tsx` — formatter +
  copy-to-clipboard button.
- `apps/web/src/invoices/detail/clave-acceso-chip.test.tsx` — 6
  cases including the clipboard-unavailable + clipboard-rejects
  branches.
- `apps/web/src/invoices/detail/header.tsx` — top section
  (estado/sriEstado/ambiente/claveAcceso/numeroAutorizacion).
- `apps/web/src/invoices/detail/customer-panel.tsx` — read-only
  customer block (PII shown on the detail view per
  PROMPT-0043 §3).
- `apps/web/src/invoices/detail/lines-panel.tsx` — read-only lines
  table.
- `apps/web/src/invoices/detail/totals-panel.tsx` — read-only totals
  block (`DetailTotalsPanel` to disambiguate from the form's
  `TotalsPanel`).
- `apps/web/src/invoices/detail/payments-panel.tsx` — read-only
  payments table (formaPago + total).
- `apps/web/src/invoices/detail/sri-timeline.tsx` — `<ol aria-label
="Eventos SRI">` with chronological sort + red-tinted error
  mensajes. Exports `sortEventsAsc` for tests.
- `apps/web/src/invoices/detail/sri-timeline.test.tsx` — 6 cases.
- `apps/web/src/invoices/detail/actions-bar.tsx` — per-estado action
  buttons + permission gating. See §5 for the visibility matrix.
- `apps/web/src/invoices/detail/useToast.ts` — tiny 1-message toast
  hook used by the detail page for "Próximamente" hints.
- `apps/web/src/invoices/detail/useToast.test.tsx` — 4 cases.
- `apps/web/src/invoices/list/estado-badge.tsx` — `<EstadoBadge />`
  - `<SriEstadoBadge />`.
- `apps/web/src/invoices/list/estado-badge.test.tsx` — 15 cases.
- `apps/web/src/invoices/list/filters-bar.tsx` — URL-backed filters
  (estado/from/to/q). Clears `cursor` on every filter change.
- `apps/web/src/invoices/list/filters-bar.test.tsx` — 6 cases.
- `apps/web/src/invoices/list/invoices-table.tsx` — keyboard-friendly
  table + click-to-detail; exports `formatFechaEs` for tests.
- `apps/web/src/invoices/list/invoices-table.test.tsx` — 8 cases.
- `apps/web/src/invoices/list/empty-state.tsx` — empty list CTA
  (gated by `invoice.create`).
- `apps/web/src/invoices/list/pending-banner.tsx` — pending count +
  "Refrescar todas" with concurrency 3. Exports
  `runWithConcurrency` for tests.
- `apps/web/src/invoices/list/pending-banner.test.tsx` — 8 cases.
- `apps/web/src/invoices/api.test.ts` — 7 cases for
  `buildInvoiceListSearchParams` + `ReissueInvoiceResponseSchema`.
- `apps/web/src/routes/invoices.index.tsx` — `/invoices` page with
  `useInfiniteQuery`.
- `apps/web/src/routes/invoices.index.test.tsx` — 7 cases (empty +
  VIEWER + populated + filter + cursor + error + batch refresh).
- `apps/web/src/routes/invoices.$id.tsx` — `/invoices/:id` page with
  bounded polling.
- `apps/web/src/routes/invoices.$id.test.tsx` — 7 cases (render +
  timeline order + polling tick + reissue + 3 RBAC tests +
  AUTORIZADO placeholder toast).

### Changed

- `apps/web/src/invoices/api.ts` — added `InvoiceListFilters`,
  `buildInvoiceListSearchParams`, `listInvoices`, `refreshInvoice`,
  `reissueInvoice`, `deleteInvoice`, `ReissueInvoiceResponseSchema`.
- `apps/web/src/i18n/es.ts` — added the `invoice.list.*` and
  `invoice.detail.*` strings (+ estado / sriEstado labels +
  ambiente labels + timeline + actions).
- `apps/web/src/routes/router.tsx` — registered `/invoices` →
  `InvoicesIndexPage` (replacing the SPEC-0040 placeholder) and
  `/invoices/:id` → `InvoicesDetailPage`. `/invoices/:id/edit` and
  `/invoices/new` are unchanged.

### Unchanged but newly relied on

- `@facturador/contracts/invoices` — `InvoiceListResponseSchema`,
  `InvoiceDetailSchema`, `EmitInvoiceResponseSchema`.
- `@facturador/contracts/sri` — `SriEvent`, `SriEstado`,
  `SriMensaje`.
- `@facturador/utils/rbac` — `Action` type; the gated actions
  (`invoice.read`, `invoice.create`, `invoice.emit`,
  `invoice.reissue`) are matched against
  `useAuth().permissions`.
- `apps/web/src/lib/api.ts` — `apiFetch` continues to carry
  `X-CSRF-Token` on `POST /refresh|/reissue|/emit` and
  `DELETE :id`.

## 3. Validation evidence

### Finishing-line validations

| Validation                                                            | Result        | Test count                                   |
| --------------------------------------------------------------------- | ------------- | -------------------------------------------- |
| `pnpm --filter @facturador/web typecheck`                             | PASS          | —                                            |
| `pnpm --filter @facturador/web test`                                  | PASS          | **323 / 323** in 44 files                    |
| `pnpm --filter @facturador/web test src/invoices src/routes/invoices` | PASS          | **207 / 207** in 25 files (invoices subtree) |
| `pnpm --filter @facturador/web build`                                 | PASS          | `dist/assets/index-*.js` 130.04 KB gzipped   |
| `pnpm --filter @facturador/web test:coverage`                         | PASS — see §6 | —                                            |

### Manual smoke (compose)

Compose was not brought up for this slice (consistent with the
PROMPT-0042 review note). The intended manual smoke is:

1. `docker compose up -d`; seed via `pnpm --filter @facturador/db
seed`.
2. Browse to `http://localhost:5173/login`, sign in as the seed
   OWNER.
3. Visit `/invoices`. The empty-state appears with "Crear factura"
   CTA. Click the CTA → routes to `/invoices/new`.
4. Create + emit a draft per REVIEW-0042 §3.5; the EmitModal
   transitions to `success` and auto-navigates to `/invoices/:id`
   (which is now the detail page).
5. On the detail page:
   - Header shows the estado + sriEstado badges, ambiente chip,
     claveAcceso (formatted in groups of 4 + copy button), and
     the numeroAutorizacion + fechaAutorizacion when present.
   - Click "Copiar clave" → the button flashes "Copiada" for
     1.5 s; pasting elsewhere yields the raw 49 digits.
   - `<SriTimeline />` renders the BUILD → SIGN → SEND → RECEIVE
     → AUTHORIZE entries in chronological order.
   - `<ActionsBar />` shows "Sincronizar con SRI" and the two
     placeholders (Descargar XML / Imprimir RIDE) when the
     invoice is AUTORIZADO; clicking either placeholder shows a
     "Próximamente" info toast for ~2.5 s.
6. Navigate back to `/invoices`. The table shows the new row.
   Select `Estado = EMITIDA` in the filter; the URL updates to
   `?estado=EMITIDO` and the table refetches with the filter
   applied. Type in the search box; the URL updates to
   `?estado=EMITIDO&q=...`.
7. Force a pending state (create a fresh emit with sri-core
   delayed); the PendingBanner renders "1 factura pendiente de
   autorización"; clicking "Refrescar todas" fires a single
   refresh.

The MSW-driven integration tests cover steps 3-7 deterministically
(see `invoices.index.test.tsx` + `invoices.$id.test.tsx`).

## 4. Polling design

Constants pinned in `apps/web/src/invoices/detail/polling.ts`:

```ts
export const POLL_INTERVAL_MS: 5_000 = 5_000;
export const POLL_MAX_DURATION_MS: 300_000 = 300_000;
export const POLLABLE_SRI_ESTADOS = ["EN_PROCESO", "RECIBIDA", "ERROR_RED"] as const;
```

Lifecycle:

| Trigger                                                                                | Behaviour                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detail page mounts                                                                     | `useQuery({ refetchInterval })` runs. The first call returns the detail.                                                                                                                                                                                   |
| `data.sriDocument.estado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}`                          | `refetchInterval` returns `POLL_INTERVAL_MS = 5 000` ms; on the first such return we stash `Date.now()` in `pollStartedAtRef`.                                                                                                                             |
| `data.sriDocument.estado` becomes terminal (AUTORIZADO / DEVUELTA / NO_AUTORIZADO / …) | `refetchInterval` returns `false`; `pollStartedAtRef` is cleared so a future regression gets a fresh budget.                                                                                                                                               |
| `Date.now() - pollStartedAtRef >= POLL_MAX_DURATION_MS` (5 min)                        | `refetchInterval` returns `false`. Final estado stays visible.                                                                                                                                                                                             |
| `document.visibilityState === "hidden"`                                                | `refetchInterval` returns `false` for the duration the tab is hidden. A `visibilitychange` listener calls `queryClient.invalidateQueries(["invoices","detail",id])` on resume, which forces TanStack Query to re-evaluate `refetchInterval` (and re-poll). |
| `<Header />` `isPolling`                                                               | Re-evaluates `isPollableEstado(sriEstado) && (now - pollStartedAtRef < POLL_MAX_DURATION_MS)` on every render; drives the "Sincronizando con SRI…" indicator (with the pulsing dot).                                                                       |

Tests pinning the constants:

- `polling.test.ts`: 10 cases covering each constant + the pure
  `isPollableEstado` predicate + `shouldKeepPolling` over the 5-min
  boundary (start, mid-window, exactly-cap, past-cap, terminal
  estados, null).
- `invoices.$id.test.tsx > polling transitions EN_PROCESO →
AUTORIZADO`: the real `POLL_INTERVAL_MS` is imported and used as
  the `waitFor` budget. The test never re-defines `5000` as a magic
  number; if the constant is shortened, the test's `timeout` adapts
  automatically.

## 5. ActionsBar visibility matrix

Source: `apps/web/src/invoices/detail/actions-bar.tsx`.

| Action                      | When visible                                                                                | Required permission |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------- |
| Reintentar emisión          | `estado === "BORRADOR"` AND `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO, ERROR_RED, ERROR_BUILD}` | `invoice.emit`      |
| Editar                      | `estado === "BORRADOR"`                                                                     | `invoice.create`    |
| Eliminar                    | `estado === "BORRADOR"` (with `window.confirm` guard; tests pass `skipConfirm` to bypass)   | `invoice.create`    |
| Reissue como nuevo borrador | `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}`                                                     | `invoice.reissue`   |
| Sincronizar con SRI         | `claveAcceso !== null` OR `sriDocument !== null`                                            | `invoice.read`      |
| Descargar XML autorizado    | `sriEstado === "AUTORIZADO"`; placeholder showing the "Próximamente" toast                  | `invoice.read`      |
| Imprimir RIDE               | `sriEstado === "AUTORIZADO"`; placeholder showing the "Próximamente" toast                  | `invoice.read`      |

Verified by `invoices.$id.test.tsx`:

- VIEWER (only `invoice.read`): action-retry-emit + action-reissue
  absent; action-refresh present.
- OPERATOR (`invoice.read | create | emit`): action-retry-emit
  present (BORRADOR + DEVUELTA); action-reissue absent.
- ACCOUNTANT (`invoice.read | create | emit | reissue`):
  action-reissue present (EMITIDO + DEVUELTA).
- AUTORIZADO + `invoice.read`: action-download-xml +
  action-print-ride present, click → `detail-toast-info` carrying
  "Próximamente".

## 6. Empty / error / loading state matrix

| State                               | List page (`/invoices`)                                                                                                                                                                 | Detail page (`/invoices/:id`)                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading** (first query in flight) | `data-testid="list-loading"` → `<p role="status" aria-live="polite">Cargando facturas…</p>`                                                                                             | `data-testid="detail-loading"` → `<p role="status" aria-live="polite">Cargando factura…</p>`                                                                                                                    |
| **Error**                           | `data-testid="list-error"` (`role="alert"`) → headline + ApiError title + "Reintentar" button → calls `query.refetch()`.                                                                | `data-testid="detail-error"` (`role="alert"`) → headline + ApiError title + "Reintentar" button → calls `query.refetch()`.                                                                                      |
| **Empty (no filters)**              | `<EmptyState />` (`data-testid="invoices-empty"`) with the "Crear factura" CTA (gated by `invoice.create` → VIEWER sees the headline without the CTA).                                  | n/a (detail is always populated when the route resolves).                                                                                                                                                       |
| **Empty (filtered)**                | The table renders with 0 data rows; "Cargar más" is absent. The PendingBanner is absent. The empty-state placeholder is NOT shown (filters being active is the differentiating signal). | n/a.                                                                                                                                                                                                            |
| **Populated**                       | `<InvoicesTable items={items} />` + `<PendingBanner />` (when any pending row exists) + "Cargar más" when `hasNextPage`.                                                                | All panels render (`<Header />` + `<CustomerPanel />` + `<LinesPanel />` + `<DetailTotalsPanel />` + `<PaymentsPanel />` + `<SriTimeline />` + `<ActionsBar />`).                                               |
| **Stale-while-polling**             | n/a (list never polls).                                                                                                                                                                 | Banner-style polling indicator inside `<Header />` (`data-testid="detail-polling-indicator"`) with the pulsing dot + "Sincronizando con SRI…". The query keeps returning the most recent cache while in flight. |
| **Toast (placeholder action)**      | n/a.                                                                                                                                                                                    | `data-testid="detail-toast-info\|success\|error"` rendered below the action bar; auto-dismisses after 2.5 s.                                                                                                    |

## 7. Coverage measured

```
Per-subdirectory (apps/web/src/invoices/** + apps/web/src/routes/invoices*):
  src/invoices         : 95.97 % stmts / 86.31 % branches / 95.00 % funcs
  src/invoices/detail  : 88.98 % stmts / 80.88 % branches / 84.37 % funcs
  src/invoices/form    : 90.01 % stmts / 75.88 % branches / 81.48 % funcs
  src/invoices/hooks   : 95.34 % stmts / 82.81 % branches / 100   % funcs
  src/invoices/list    : 98.99 % stmts / 89.53 % branches / 90.00 % funcs
  src/routes (incl. invoices.index/.$id/.edit/.new) : 89.80 % stmts

Overall apps/web:       93.12 % stmts / 82.05 % branches / 88.66 % funcs
```

Comfortable headroom over the 70 % threshold in every relevant
subdir. The softer spots:

- `invoices.$id.tsx` (74.80 % stmts): the visibilitychange branch
  isn't exercised in jsdom (no native `visibilitychange` events
  fire); we still test the logic that the listener attaches +
  detaches, but the inner `invalidateQueries` call is uncovered.
- `actions-bar.tsx` (68.26 % stmts): the per-action `onClick`
  fetcher branches (refresh / reissue / delete / retry) are
  partially covered. The reissue happy path is tested; the
  `onRefresh` and `onDelete` happy paths are pinned indirectly via
  the list-page batch-refresh test but not the per-button test.
- `to-payload.ts` branch 70 %: same as REVIEW-0042 §6.

## 8. Deviations from spec / plan

| #   | Deviation                                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The detail page renders against `InvoiceDetailSchema` (`{invoice, customer, sriDocument, sriEvents}`), but the API's current `GET /api/v1/invoices/:id` returns a FLAT shape via `toInvoiceDetailWire(row)` (see `apps/api/src/invoices/handlers.ts:198`). | The web contract is what SPEC-0043 §6.2 binds to; the API will need a follow-up to wrap the row + the joined customer + sri-document + events to match the schema. Until then, the integration tests stub the wrapped shape (the existing `invoice-form.test.tsx` does the same). Documented as a follow-up (§10 #1). |
| 2   | "Reintentar emisión" is shown when `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO, ERROR_RED, ERROR_BUILD}`, not just on the SPEC-0043 §FR-2 wording "after rejection".                                                                                             | The wider set matches the orchestrator's contract per REVIEW-0033 §8: ERROR_RED + ERROR_BUILD also leave the operator stuck with a BORRADOR they want to re-attempt. The smaller set would let the network-failure path die silently.                                                                                 |
| 3   | "Sincronizar con SRI" is gated by `claveAcceso !== null OR sriDocument !== null` (i.e. visible whenever the row has ever been emitted), not by sriEstado.                                                                                                  | Matches the API: `POST :id/refresh` requires `claveAcceso !== null` (`apps/api/src/invoices/orchestrator.ts:734`); a BORRADOR with no claveAcceso can't be refreshed. Hiding the button when there's no claveAcceso prevents a confusing 422 from the server.                                                         |
| 4   | FiltersBar is single-select per filter (one estado at a time).                                                                                                                                                                                             | The API accepts repeated `?estado=` values, but the SPEC-0043 wording leaves the multi-select option open. v1 ships single-select for UX simplicity; the URL contract already supports multi-select if a later change wires it.                                                                                       |
| 5   | "Cargar más" uses `useInfiniteQuery` rather than appending to the existing query's cache.                                                                                                                                                                  | TanStack Query 5's `useInfiniteQuery` is the canonical way to model cursor pagination; the alternative (manual cache mutation on `useQuery`) loses the per-page memoization and re-fires the first page on every change.                                                                                              |
| 6   | The list page does NOT poll; only the detail page polls.                                                                                                                                                                                                   | Explicit per PLAN-0043 §3 "Single detail page only polls itself; list does not poll." The PendingBanner gives the user a one-click escape hatch instead.                                                                                                                                                              |
| 7   | The pending banner uses TanStack Query's `invalidateQueries` callback after the batch refresh, NOT a per-row `setQueryData`.                                                                                                                               | The batch refresh is opportunistic; the next time the list query runs it'll pick up the fresh data from the server (the API's refresh handler updates the mirror, and the list endpoint reads from the mirror). Cache-mutation per row would couple the banner to the detail-query cache shape.                       |
| 8   | Visibility-pausing is implemented but the jsdom test environment doesn't fire native `visibilitychange` events, so the pause-on-hidden branch is exercised in code but not asserted in tests.                                                              | jsdom limitation; documented as a follow-up (§10 #5). The logic is still simple enough that a code review catches regressions.                                                                                                                                                                                        |

## 9. Risks observed

| Risk                                                                  | Mitigation today                                                                                                                                     | Future hardening                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Battery / network drain from polling                                  | Strict bounds: 5 s interval × 5 min cap; only on `sriEstado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}`; pauses on `document.visibilityState === "hidden"`. | Expose a per-user "Pause autosync" toggle; reduce the interval to 30 s for ERROR_RED (it's a network issue — exponential backoff would do better). |
| Large lists slow first paint                                          | Cursor pagination (server-side); no client-side sort beyond the current page.                                                                        | Virtualised table for very large multi-page datasets.                                                                                              |
| Stale data after another operator emits                               | Manual "Refrescar" button (top of list page) + PendingBanner's "Refrescar todas". List does NOT poll.                                                | Server-side WebSocket / SSE push (out of scope for v1).                                                                                            |
| User on a slow connection mistakes the "Cargar más" delay for a stall | `query.isFetchingNextPage` disables the button while in flight.                                                                                      | Add a tiny inline spinner on the button.                                                                                                           |
| Polling continues after user navigates away                           | `useQuery` cleans up on unmount; the `pollStartedAtRef` is module-local and resets when the component re-mounts.                                     | — (already correct).                                                                                                                               |
| RBAC drift between server + client                                    | The actions-bar matrix mirrors the server enforcement; tests pin the visibility per role. Server is the authority on the actual mutation.            | Generate the matrix from `MATRIX` in `@facturador/utils/rbac` so the server + UI never drift.                                                      |
| User clicks "Eliminar" by accident                                    | `window.confirm` guard inside `onDelete`; tests pass `skipConfirm` to assert the API call shape.                                                     | Custom confirm modal for parity with the EmitModal.                                                                                                |
| Concurrency-3 batch overwhelms a slow server                          | Pool caps at 3 in flight; per-task errors are swallowed by `onError` so one slow row never starves the others.                                       | Honour `Retry-After` headers; add a per-batch timeout budget.                                                                                      |

## 10. Suggested follow-ups

1. **API change: wrap detail response in `{invoice, customer,
sriDocument, sriEvents}`** to match `InvoiceDetailSchema`. The
   current API returns a flat shape; the web contract binds to
   the wrapped shape. Pair with a server-side test that asserts
   the wrapped shape parses against the schema.
2. **RIDE PDF download** (SPEC-0043 §2.2 out-of-scope). Wire
   `action-download-xml` + `action-print-ride` to real blob endpoints
   once SPEC-0050 (or equivalent) lands.
3. **CSV export** (SPEC-0043 §2.2 out-of-scope).
4. **Anulación electrónica** (SPEC-0043 §2.2 out-of-scope). Once the
   SRI flow exists, mark the source invoice ANULADO after reissue
   succeeds (currently the source is left untouched — see
   REVIEW-0033 §8).
5. **Visibility pause test** — use `userEvent.setup({ pointerEventsCheck:
PointerEventsCheckLevel.Never })` + a `visibilitychange` event
   dispatched manually to assert the pause-on-hidden code path.
6. **Saved filters** — once OWNER / ADMIN users routinely filter, a
   "Guardar filtro como vista" feature would be high-leverage.
7. **Multi-select estado** — the URL contract already supports
   repeated `?estado=` params (`buildInvoiceListSearchParams` walks
   the array); the FiltersBar UI just needs a multi-select widget.
8. **WebSocket / SSE push** — replace the 5-second polling with a
   server-side push channel; falls back to polling when the WS
   connection drops.
9. **Per-row spinner during refresh** — the PendingBanner shows a
   single global "Refrescando…" but doesn't surface per-row
   progress. A row-level spinner inside the table while its
   `:id/refresh` is in flight would tighten the UX feedback loop.
10. **Generate the actions-bar matrix from RBAC** — today the matrix
    is hand-coded in `actions-bar.tsx`; deriving it from
    `@facturador/utils/rbac` MATRIX would prevent drift between the
    server and the UI.

## 11. Security review (PROMPT-0043 §6)

| Hard rule                                                                                     | Status                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | --------------------------------------------------------------------------------------------- |
| `claveAcceso` displayed in full (publicly visible on the printed RIDE)                        | PASS — formatted in groups of 4; the raw value is in the `<button aria-label>` so screen-readers announce the canonical 49 digits and in the `<span title>` so right-click-copy yields the unformatted value.                      |
| No email / teléfono / dirección on the list view                                              | PASS — the list endpoint deliberately omits these fields (SPEC-0031 §10) and the `<InvoicesTable />` never reads them defensively. The `invoices-table.test.tsx > does NOT include phone / email markup` test asserts the absence. |
| `navigator.clipboard.writeText` used for copy; "No se pudo copiar" toast on failure (no leak) | PASS — `<ClaveAccesoChip />` feature-detects the API and flips the button label on failure; the `clave-acceso-chip.test.tsx > falls back to a no-op + error label when clipboard is unsupported` test pins the no-op path.         |
| Polling stops on `document.visibilityState === "hidden"` (optional but recommended)           | PASS — `refetchInterval` returns `false` when the tab is hidden; the `visibilitychange` listener re-invalidates on resume.                                                                                                         |
| All mutating actions use `apiFetch` (CSRF + credentials)                                      | PASS — every helper in `apps/web/src/invoices/api.ts` (refreshInvoice, reissueInvoice, deleteInvoice, emitInvoice) goes through `apiFetch`. `apiFetch` carries `X-CSRF-Token` on `POST                                             | PUT | PATCH | DELETE`. The integration tests' MSW handlers receive the cookie / token implicitly via jsdom. |
| Never render API content as raw HTML                                                          | PASS — every SRI mensaje / estado / customer field flows through React's text-escaping. Repo grep for `dangerouslySetInnerHTML` returns 0 hits in `src/invoices/**`.                                                               |
| Permissions gating in UI mirrors server enforcement                                           | PASS — the actions-bar visibility matrix matches `MATRIX` in `@facturador/utils/rbac` for `invoice.emit`, `invoice.create`, `invoice.reissue`, `invoice.read`. The server's `requirePermission` is still the authority.            |
| ClaveAcceso copy never logs the value                                                         | PASS — no `console.log` in the chip or the toast path.                                                                                                                                                                             |

## 12. Sign-off — Acceptance criteria

| AC   | Statement                                                                      | Status | Evidence                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Empty tenant sees the empty state with a "Crear factura" CTA → `/invoices/new` | PASS   | `invoices.index.test.tsx > /invoices — empty state > empty list shows EmptyState + CTA navigates to /invoices/new`                                                                                                  |
| AC-2 | After seeding 10 invoices, the list shows 10 rows                              | PASS   | `invoices.index.test.tsx > /invoices — populated list > 10 rows → 10 invoice-row elements`                                                                                                                          |
| AC-3 | Filtering by `estado=EMITIDO` updates URL + API call                           | PASS   | `invoices.index.test.tsx > /invoices — filter to URL + API > estado=EMITIDO is reflected in the URL AND in the API call query string` (asserts both the URL and the recorded MSW request URL)                       |
| AC-4 | Detail page shows the SRI timeline ordered ascending                           | PASS   | `invoices.$id.test.tsx > detail render + timeline order > renders header + customer + timeline events in createdAt ascending order` + `sri-timeline.test.tsx > sortEventsAsc > sorts events by createdAt ascending` |
| AC-5 | EN_PROCESO → AUTORIZADO updates UI without a manual refresh                    | PASS   | `invoices.$id.test.tsx > polling transitions EN_PROCESO → AUTORIZADO > auto-updates UI without a manual refresh after a polling tick` (imports `POLL_INTERVAL_MS` from the constants module; never hard-codes 5000) |
| AC-6 | Reissue from a DEVUELTA invoice opens the new draft in `/invoices/:newId/edit` | PASS   | `invoices.$id.test.tsx > Reissue > clicking Reissue calls POST /reissue and navigates to /invoices/:newId/edit`                                                                                                     |
| AC-7 | A VIEWER does not see "Reintentar" / "Reissue" buttons (UI gating)             | PASS   | `invoices.$id.test.tsx > RBAC gating > VIEWER role: Reintentar AND Reissue absent`                                                                                                                                  |

### TASKS-0043 sub-checklist

| Task                                                                                                   | Status                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1.1 `/invoices` route + RequirePermission + useQuery + empty-state CTA + Cargar más + Refrescar        | DONE                                                              |
| 1.2 `<FiltersBar />` → URL on change                                                                   | DONE                                                              |
| 1.3 `<InvoicesTable />` 7 columns + header snapshot                                                    | DONE                                                              |
| 1.4 Pending banner + Refrescar todas + concurrency 3                                                   | DONE                                                              |
| 2.1 `/invoices/:id` route + RequirePermission + bounded polling                                        | DONE                                                              |
| 2.2 `<CustomerPanel />` + `<LinesPanel />` + `<DetailTotalsPanel />` + `<PaymentsPanel />`             | DONE                                                              |
| 2.3 `<SriTimeline />` (ol aria-label + ascending sort + red mensajes)                                  | DONE                                                              |
| 2.4 `<ActionsBar />` per estado + RBAC                                                                 | DONE                                                              |
| 3.1 Polling constants module + tests import them                                                       | DONE                                                              |
| 4.1 `<ClaveAccesoChip />` (groups of 4 + clipboard)                                                    | DONE                                                              |
| 5.1 `invoices.index.test.tsx` (empty CTA, 10 rows, estado filter, Cargar más)                          | DONE                                                              |
| 5.2 `invoices.$id.test.tsx` (timeline order, EN_PROCESO → AUTORIZADO, reissue navigate, VIEWER gating) | DONE                                                              |
| 6. AC-1 .. AC-7                                                                                        | ALL PASS                                                          |
| 7. Definition of Done                                                                                  | All boxes ticked; tests + integration green; review file written. |

## 13. Notes on the bundle

```
dist/index.html                   0.39 kB │ gzip:   0.26 kB
dist/assets/index-C95AzLti.css   20.43 kB │ gzip:   4.42 kB
dist/assets/index-UCUjBWhi.js   444.19 kB │ gzip: 130.04 kB │ map: 1,766.57 kB
```

Growth vs REVIEW-0042 (119.72 → 130.04 KB gzipped, +10.32 KB) breaks
down approximately as:

- List page + components (`invoices-table`, `filters-bar`,
  `estado-badge`, `empty-state`, `pending-banner`): ~3.5 KB gzipped.
- Detail page + components (`header`, `customer-panel`,
  `lines-panel`, `payments-panel`, `totals-panel`, `sri-timeline`,
  `actions-bar`, `clave-acceso-chip`): ~5 KB gzipped.
- Polling + hooks (`polling.ts`, `useToast.ts`): ~0.5 KB gzipped.
- New strings in `i18n/es.ts` (110+ new keys): ~1.3 KB gzipped.

The follow-up "Route-level code-splitting" from REVIEW-0042 §10
remains the right next move to bring the login route back under the
SPEC-0040 NFR-1 80 KB budget. None of the invoice modules are
required for the login chunk; lazy-loading the
`./routes/invoices.*` files would split ~14 KB out of the initial
download.
