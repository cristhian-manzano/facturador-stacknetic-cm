---
id: PROMPT-0042
spec: SPEC-0042
plan: PLAN-0042
tasks: TASKS-0042
title: Execute TASKS-0042 — Invoice creation UI
---

# PROMPT-0042 — Execute invoice creation UI

You are an autonomous senior frontend engineer. Execute **TASKS-0042**: build the factura form at `/invoices/new` and `/invoices/:id/edit`, with debounced live totals, auto-save, customer combobox + inline create, and the emit modal state machine.

---

## 1. Mandatory reading

1. `ai/specs/0042-web-invoice-create.md` — authoritative.
2. `ai/plans/0042-web-invoice-create-plan.md`.
3. `ai/tasks/0042-web-invoice-create-tasks.md`.
4. `ai/specs/0005-shared-contracts.md` — `CreateInvoiceSchema`, `CreateCustomerSchema`.
5. `ai/specs/0032-invoice-domain.md` — totals contract, IVA selector.
6. `ai/specs/0033-invoice-emission-orchestrator.md` — emit + error shapes.
7. `ai/specs/0040-web-app-bootstrap.md`, `ai/specs/0041-web-auth-flows.md` — bootstrap & guards.
8. `ai/specs/0030-emission-points-and-sequencing.md` — punto de emisión.
9. `ai/specs/0031-customer-catalog.md` — customer catalog.
10. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the new/edit routes, form, hooks, dialog, and emit modal.
- ❌ Do NOT implement list/detail pages (SPEC-0043).
- ❌ Do NOT compute totals client-side. Always preview via API; never persist a client-side total.
- ❌ Do NOT bypass `apiFetch`.
- ❌ Do NOT use localStorage for drafts.

## 3. Stack constraints

- React 18, React Router 6, React Hook Form, TanStack Query 5, Tailwind 3.
- Zod via `@facturador/contracts/invoices` + `/customers`.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Numeric inputs are text + `inputMode="decimal"`; parsing via a shared `parseMoney` helper.
- Forms use stable field arrays; rows have keys derived from RHF's `useFieldArray` ids.
- Debounce uses AbortController; new requests cancel in-flight ones.
- Auto-save is idempotent (silent PATCH); duplicate fires within 30 s window collapse.
- Emit modal uses an explicit state machine with `useReducer` (not ad-hoc booleans).
- All ARIA roles: form fields labelled; modal `role="dialog" aria-modal="true"`; toast `role="status"`.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/web test apps/web/src/invoices/**/*.test.tsx` exits 0.
- Coverage on `apps/web/src/invoices/**` ≥ 70%.
- Manual smoke: in compose, log in as seed user, navigate to `/invoices/new`, add a line `1 × 100 IVA 15%`, see totals `100 / 15 / 115`, set payment `115.00`, click Emitir, observe Emitir modal AUTORIZADO, redirected to `/invoices/:id`.
- VIEWER role redirected to `/forbidden` on `/invoices/new`.

## 6. Security considerations

- The form never stores tokens or sensitive data in localStorage.
- File uploads (not in this spec) and other side channels NOT introduced here.
- Modal traps focus; Esc closes only when not in `submitting` state.
- All mutating requests carry CSRF via `apiFetch`.
- `parseMoney` rejects unparseable values; never coerces silently.

## 7. Deliverables

When TASKS-0042 is green, write `ai/reviews/0042-web-invoice-create-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test coverage report on invoice modules.
   - Manual smoke notes (or screenshots).
   - A small video/gif description of the flow (optional).
4. **State machine** — paste the emit modal reducer.
5. **Debounce / abort design** — text.
6. **Deviations from spec/plan**.
7. **Risks observed** — autosave conflicts; long total previews; combobox accessibility.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — templates, clone, bulk lines paste from CSV.
10. **Sign-off checklist** — SPEC-0042 AC-1…AC-8 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0042 boxes ticked.
- Tests + manual smoke green.
- Review file complete.

Begin.
