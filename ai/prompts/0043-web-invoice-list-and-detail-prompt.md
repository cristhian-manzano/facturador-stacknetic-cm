---
id: PROMPT-0043
spec: SPEC-0043
plan: PLAN-0043
tasks: TASKS-0043
title: Execute TASKS-0043 — Invoice list & detail UI
---

# PROMPT-0043 — Execute invoice list & detail UI

You are an autonomous senior frontend engineer. Execute **TASKS-0043**: build the `/invoices` list (with URL-backed filters and cursor pagination) and `/invoices/:id` detail (with SRI events timeline, bounded polling, and per-estado actions).

---

## 1. Mandatory reading

1. `ai/specs/0043-web-invoice-list-and-detail.md` — authoritative.
2. `ai/plans/0043-web-invoice-list-and-detail-plan.md`.
3. `ai/tasks/0043-web-invoice-list-and-detail-tasks.md`.
4. `ai/specs/0032-invoice-domain.md`, `0033-invoice-emission-orchestrator.md` — server contracts.
5. `ai/specs/0040-web-app-bootstrap.md`, `0041-web-auth-flows.md` — bootstrap.
6. `ai/specs/0042-web-invoice-create.md` — the form the actions link to.
7. `ai/specs/0005-shared-contracts.md` — `InvoiceListResponseSchema`, `InvoiceDetailSchema`.
8. `ai/specs/0011-tenants-memberships-rbac.md` — permissions.
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only list + detail routes and their components.
- ❌ Do NOT implement RIDE PDF, CSV export, or anulación. Placeholders only with "Próximamente" toasts.
- ❌ Polling MUST be bounded (5 s × 5 min cap).
- ❌ Never render API HTML; always plain text.
- ❌ Never display teléfonos/emails on the list.

## 3. Stack constraints

- React 18, React Router 6 data router, TanStack Query 5, Tailwind 3, RHF.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Polling constants centralised; tests import them rather than re-defining numbers.
- ClaveAcceso copy uses `navigator.clipboard.writeText` with a fallback no-op when unsupported.
- Lists/tables are keyboard-accessible (tab order + visible focus; arrow-key row nav not required for v1).
- Empty states & error states are first-class components.
- All API responses validated via Zod before consumers see them.
- Permissions gating in UI mirrors server enforcement.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/web test apps/web/src/invoices/**/*.test.tsx` exits 0.
- MSW transitions an EN_PROCESO invoice to AUTORIZADO during the test; UI auto-updates.
- Filter `estado=EMITIDO` is reflected in URL and forwarded to the API call.
- Reissue path navigates to `/invoices/:newId/edit`.
- VIEWER role does not see Reintentar/Reissue.
- Coverage on invoice modules ≥ 70%.
- Manual smoke: in compose, navigate to `/invoices`, filter, open one detail, observe timeline.

## 6. Security considerations

- ClaveAcceso is shown in full (publicly visible on the printed RIDE) — fine.
- Never include emails / phones / addresses in tooltips on the list.
- Copy-to-clipboard: use a button that triggers `navigator.clipboard.writeText`; if the browser denies, show "No se pudo copiar" toast (no leak).
- Polling stops on tab hidden via `document.visibilityState === "hidden"` (optional but recommended).
- All mutating actions use `apiFetch` (CSRF + credentials).

## 7. Deliverables

When TASKS-0043 is green, write `ai/reviews/0043-web-invoice-list-and-detail-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test outputs.
   - Manual smoke notes.
4. **Polling design** — constants + when it starts/stops.
5. **Empty/error/loading state matrix**.
6. **Deviations from spec/plan**.
7. **Risks observed** — polling battery, large lists, perceived freshness.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — RIDE PDF; CSV export; anulación; saved filters.
10. **Sign-off checklist** — SPEC-0043 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0043 boxes ticked.
- Tests + manual smoke green.
- Review file complete.

Begin.
