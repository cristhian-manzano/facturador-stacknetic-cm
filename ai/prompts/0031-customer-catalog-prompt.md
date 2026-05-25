---
id: PROMPT-0031
spec: SPEC-0031
plan: PLAN-0031
tasks: TASKS-0031
title: Execute TASKS-0031 — Customer catalog
---

# PROMPT-0031 — Execute customer catalog

You are an autonomous senior backend engineer. Execute **TASKS-0031**: build the tenant-scoped customer catalog, per-branch validation, CRUD endpoints, search, and the `ensureConsumidorFinal` helper.

---

## 1. Mandatory reading

1. `ai/specs/0031-customer-catalog.md` — authoritative.
2. `ai/plans/0031-customer-catalog-plan.md`.
3. `ai/tasks/0031-customer-catalog-tasks.md`.
4. `ai/specs/0005-shared-contracts.md` — discriminated `CustomerSchema`.
5. `ai/specs/0011-tenants-memberships-rbac.md` — RBAC for `customer.*`.
6. `ai/specs/0033-invoice-emission-orchestrator.md` — downstream user of `ensureConsumidorFinal`.
7. `docs/sri-facturacion-electronica-ecuador.md` — identification rules.
8. `ai/context/glossary.md` — Spanish terms verbatim.
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only customer model + validation + endpoints + helper.
- ❌ Do NOT implement CSV import, GDPR export, or any UI here.
- ❌ Do NOT allow `companyId` in any request body.
- ❌ Do NOT hard-delete; soft-delete only.

## 3. Stack constraints

- Prisma 5; Express 5; Zod via `@facturador/contracts`.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Per-branch validation factored into a single function and shared between POST and PATCH.
- Cursor pagination is consistent across the API (ULID-ordered).
- All identifier columns checked with the same checksum helpers used by the contracts layer.
- `ensureConsumidorFinal` is the only writer of the 07 / 9999...9999 row; the API rejects manual creation with that fixed identifier (return 409 with `code: "use_helper"`).

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test apps/api/test/customers.test.ts` exits 0.
- Per-branch validation tests pass (≥ 10).
- Cross-tenant probes do not leak.
- `ensureConsumidorFinal` is idempotent (rows = 1 after 5 calls).
- Search test seeds 5 customers and asserts hit counts for several `q` queries.

## 6. Security considerations

- All queries scoped by `req.companyId`.
- Reject manual creation of the Consumidor Final identificacion (`9999999999999`) outside the helper.
- Telephone / email are optional; if present they are stored as-is. No external lookups.
- Audit rows record `customer.created/updated/deleted` with companyId + actorUserId; never include the full row payload (just `customerId` + summary).
- Email column is never used as a unique key for the customer catalog.

## 7. Deliverables

When TASKS-0031 is green, write `ai/reviews/0031-customer-catalog-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence** — test outputs.
4. **Validation table** — per-branch required fields.
5. **Search behaviour** — exact query used; index relied upon.
6. **Deviations from spec/plan**.
7. **Risks observed** — performance under large catalogs; collation pitfalls.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — CSV import, full-text search.
10. **Sign-off checklist** — SPEC-0031 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0031 boxes ticked.
- Tests green; helper idempotent.
- Review file complete.

Begin.
