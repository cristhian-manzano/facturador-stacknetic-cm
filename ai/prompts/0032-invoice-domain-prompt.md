---
id: PROMPT-0032
spec: SPEC-0032
plan: PLAN-0032
tasks: TASKS-0032
title: Execute TASKS-0032 — Invoice domain
---

# PROMPT-0032 — Execute invoice domain

You are an autonomous senior backend engineer with strong numeric / accounting background. Execute **TASKS-0032**: build the invoice aggregate, the `computeInvoice` pure function with decimal.js, the IVA rate selector, and the CRUD + preview endpoints.

---

## 1. Mandatory reading

1. `ai/specs/0032-invoice-domain.md` — authoritative.
2. `ai/plans/0032-invoice-domain-plan.md`.
3. `ai/tasks/0032-invoice-domain-tasks.md`.
4. `docs/sri-facturacion-electronica-ecuador.md` — IVA codes, percentages, calc rules.
5. `ai/specs/0005-shared-contracts.md` — invoice schemas.
6. `ai/specs/0030-emission-points-and-sequencing.md`, `0031-customer-catalog.md` — dependencies.
7. `ai/context/glossary.md`.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Models + compute + endpoints + IVA rate selector.
- ❌ Do NOT implement emit pipeline (SPEC-0033 owns it).
- ❌ Do NOT call sri-core from here.
- ❌ Do NOT use `Number` for money math.

## 3. Stack constraints

- Prisma 5; Express 5; Zod via contracts; decimal.js.
- TypeScript strict; ESM only.

## 4. Code quality bar

- `computeInvoice` is pure (no I/O, no clock reads except via injected `now`).
- Money columns use `@db.Decimal(precision,scale)`; reads return strings or Decimal; conversions explicit.
- Endpoint handlers thin; business logic in services.
- Property tests cover sum invariants; deterministic seed.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test apps/api/test/invoices.test.ts` exits 0.
- 100% statement coverage on `compute.ts`.
- Property test runs ≥ 100 cases; all pass.
- Boundary IVA test at 2024-03-31 / 2024-04-01.
- Edit on EMITIDO → 422 `code: "locked"`.
- Cursor pagination test paginates 25 invoices into 2 batches; no duplicates, no missed rows.

## 6. Security considerations

- All queries scoped to `req.companyId`.
- `customerId` validated to belong to the same tenant before persistence.
- Audit rows for create/update/delete include companyId + actorUserId + invoiceId only.
- Money rounding rule documented in the review file (half-away-from-zero or banker's; pick one and justify).
- Avoid sub-second clock-dependent behaviour; `fechaEmision` always derived from caller's `YYYY-MM-DD` (Ecuador local).

## 7. Deliverables

When TASKS-0032 is green, write `ai/reviews/0032-invoice-domain-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage on `compute.ts`.
   - Property test result.
   - Endpoint tests output.
   - Migration SQL snippet.
4. **Money math contract** — code excerpt + commentary.
5. **IVA table** — exact `(codigo, codigoPorcentaje, percentage, validFrom)` rows.
6. **Deviations from spec/plan**.
7. **Risks observed** — currency precision; future need for NC/ND IVA splits.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — VAT-exempt categories; multi-currency; exporting historical IVA tables.
10. **Sign-off checklist** — SPEC-0032 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0032 boxes ticked.
- Property tests green; coverage met.
- Review file complete.

Begin.
