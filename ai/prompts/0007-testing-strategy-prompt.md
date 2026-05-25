---
id: PROMPT-0007
spec: SPEC-0007
plan: PLAN-0007
tasks: TASKS-0007
title: Execute TASKS-0007 — Testing strategy
---

# PROMPT-0007 — Execute testing strategy

You are an autonomous senior engineer specialised in test infrastructure for TypeScript monorepos. Execute **TASKS-0007**: stand up the Vitest harness, per-test Postgres schema isolation, MSW, Supertest factories, fixture policy, and coverage enforcement.

---

## 1. Mandatory reading

1. `ai/specs/0007-testing-strategy.md` — authoritative.
2. `ai/plans/0007-testing-strategy-plan.md`.
3. `ai/tasks/0007-testing-strategy-tasks.md`.
4. `ai/specs/0004-database-and-prisma.md` — Prisma migrations / models the harness drives.
5. `ai/specs/0005-shared-contracts.md` — MSW handlers validate against these schemas.
6. `ai/specs/0006-error-model-and-logging.md` — logger needs a test transport.
7. `ai/context/security.md` — fixtures policy (no real RUCs, no real customer data).
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Build only the infrastructure listed in TASKS-0007.
- ❌ Do not write business-domain tests here (those land in later specs).
- ❌ Do not commit a real `.env` or any real `DATABASE_URL` containing credentials.
- ❌ Do not weaken coverage thresholds. If thresholds aren't met, add real tests, not exclusions.
- ❌ Do not skip the forced-failure smoke; it proves CI catches regressions.

## 3. Stack constraints

- Vitest 2.x with `@vitest/coverage-v8`.
- MSW 2.x.
- Supertest (latest).
- `@testing-library/react` + `@testing-library/jest-dom` for web.
- Prisma 5.x for schema isolation.

## 4. Code quality bar

- One source of truth for Vitest config (`@facturador/config/vitest`).
- The schema harness must be safe under Vitest parallelism (`poolOptions.threads.maxThreads ≥ 2`).
- MSW handlers must `parse` (not `safeParse`) their response payloads against the contract schemas — failures should crash the handler and surface in the test.
- Fixtures are pure functions; no global mutable state.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm -r test` exits 0.
- `pnpm -r test --coverage` exits 0 and prints a per-package thresholds-met line.
- The two parallel DB tests in TASKS §2.1 show schema isolation (count = 1 in each, not 2).
- The forced-broken test in TASKS §8.1 actually fails the build; the file was then deleted; the subsequent run is green.

If any check fails, fix the cause; do not loosen the contract.

## 6. Security considerations

- All fixtures use synthetic data:
  - RUCs start with `9999`.
  - Emails end in `@facturador.test`.
  - Passwords in fixtures are random + non-production-looking (e.g., `Fixture_${randomBytes(8).toString("hex")}`).
- No fixture contains a real cert, signed XML, or claveAcceso belonging to a real RUC.
- The test-mode logger must not emit to a file system path that survives the test run.
- DB harness must DROP its schema on teardown even if the test threw — wrap in try/finally.

## 7. Deliverables

When TASKS-0007 is green, write `ai/reviews/0007-testing-strategy-review.md` with:

1. **Summary**.
2. **Files created / changed** — absolute paths.
3. **Validation evidence**:
   - `pnpm -r test --coverage` summary table (package → statements% → branches%).
   - Output of the parallel-schema isolation test.
   - Demonstration that the forced-broken test failed and removal restored green.
4. **Harness mechanics** — short paragraph on how `createTestSchema` works under parallel Vitest.
5. **Coverage thresholds** — final values per package and rationale.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., test runtime under load; schema creation overhead.
8. **Security review** — confirm fixture policy, no real data; explain how the test logger is sandboxed.
9. **Suggested follow-ups** — e.g., add Playwright for E2E; add mutation testing.
10. **Sign-off checklist** — SPEC-0007 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; details in the review file.

## 9. Exit condition

- All TASKS-0007 boxes ticked.
- All listed test runs green with thresholds met.
- Review file complete.

Begin.
