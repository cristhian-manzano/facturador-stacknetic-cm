---
id: PROMPT-0030
spec: SPEC-0030
plan: PLAN-0030
tasks: TASKS-0030
title: Execute TASKS-0030 — Emission points & sequencing
---

# PROMPT-0030 — Execute emission points & sequencing

You are an autonomous senior backend engineer with deep transactional-Postgres experience. Execute **TASKS-0030**: build the establecimiento / punto de emisión models, the atomic `reserveSecuencial` service, the burn helper, and CRUD endpoints.

---

## 1. Mandatory reading

1. `ai/specs/0030-emission-points-and-sequencing.md` — authoritative.
2. `ai/plans/0030-emission-points-and-sequencing-plan.md`.
3. `ai/tasks/0030-emission-points-and-sequencing-tasks.md`.
4. `docs/sri-facturacion-electronica-ecuador.md` — sequencing rules ("no reuse").
5. `ai/specs/0011-tenants-memberships-rbac.md` — RBAC matrix; `establecimiento.manage` action.
6. `ai/specs/0006-error-model-and-logging.md` — audit + ProblemDetail.
7. `ai/specs/0033-invoice-emission-orchestrator.md` — downstream consumer of `reserveSecuencial` and `burnSecuencial`.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the models, services, helpers, and CRUD endpoints in TASKS-0030.
- ❌ Do NOT introduce per-emission-point certificate bindings (later spec).
- ❌ Do NOT release or reuse a secuencial.
- ❌ Do NOT accept `companyId` from request bodies.

## 3. Stack constraints

- Prisma 5 with `Serializable` isolation.
- Express 5 (existing middleware chain).
- Zod (`@facturador/contracts`).
- TypeScript strict; ESM only.

## 4. Code quality bar

- `reserveSecuencial` is implemented as a small, testable function that takes `{ prisma }` and `{ args }` separately — no module-level singletons.
- Retry logic catches only Prisma serialization conflicts and rethrows everything else.
- Default-emission-point toggle runs in a transaction; the `isDefault` invariant is "at most one default per establecimiento".
- All routes go through `requireTenant` + `requirePermission`.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test` exits 0.
- Concurrency stress test: 20 × 100 reservations → 2000 unique monotonic values; report elapsed time.
- CRUD integration tests: each role × each route returns the documented status.
- Soft-delete confirmed via DB row check.
- Burn helper integration test: row exists with the expected `reason`.

## 6. Security considerations

- All queries scoped by `req.companyId`. A cross-tenant probe returns 404 (do not differentiate from "not found").
- Audit rows contain companyId + actorUserId; never secuencial details that the user shouldn't see (they're allowed to see their own — fine).
- Establecimiento `codigo` and emission-point `codigo` validated as exactly 3 digits; reject any non-numeric input.
- Soft-deleted rows excluded by default in every read.

## 7. Deliverables

When TASKS-0030 is green, write `ai/reviews/0030-emission-points-and-sequencing-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Concurrency stress test result with elapsed time.
   - Integration tests output.
   - Migration SQL snippet.
4. **Reservation algorithm** — code excerpt + commentary on Serializable + retry behaviour.
5. **Burn helper** — code excerpt + usage pattern.
6. **Deviations from spec/plan**.
7. **Risks observed** — peak throughput; Postgres serialization conflict frequency in your run.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — per-emission-point cert binding; CSV export of burned secuenciales.
10. **Sign-off checklist** — SPEC-0030 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0030 boxes ticked.
- Concurrency stress proven green.
- Review file complete.

Begin.
