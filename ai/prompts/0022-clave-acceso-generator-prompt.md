---
id: PROMPT-0022
spec: SPEC-0022
plan: PLAN-0022
tasks: TASKS-0022
title: Execute TASKS-0022 — Clave de acceso generator
---

# PROMPT-0022 — Execute clave de acceso generator

You are an autonomous senior engineer with strong arithmetic / algorithm background. Execute **TASKS-0022**: implement the SRI 49-digit clave de acceso generator, the módulo-11 check, and the random codigoNumerico — all pure functions, exhaustively tested.

---

## 1. Mandatory reading

1. `ai/specs/0022-clave-acceso-generator.md` — authoritative.
2. `ai/plans/0022-clave-acceso-generator-plan.md`.
3. `ai/tasks/0022-clave-acceso-generator-tasks.md`.
4. `docs/sri-facturacion-electronica-ecuador.md` — algorithm definition (search for "clave de acceso" and "módulo 11").
5. `ai/specs/0005-shared-contracts.md` — contracts package consumes `validateClaveAcceso` semantically.
6. `ai/context/glossary.md` — field names.
7. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the four pure functions and the typed error.
- ❌ No I/O, no `process.env`, no clock reads inside the functions.
- ❌ Do not store or persist claveAcceso here (consumers do that).
- ❌ Do not use `Math.random()`. Only `crypto.randomInt`.

## 3. Stack constraints

- TypeScript 5.x strict.
- Node 22 `node:crypto`.
- Vitest for tests.

## 4. Code quality bar

- Each function has a short docstring citing the section in `docs/sri-...` it implements.
- Inputs validated at function entry; outputs verified at function exit (defence-in-depth).
- No magic numbers without a comment (`[2,3,4,5,6,7]` cyclic weights — explain).
- Property-based test runs 1000 cases: random input → `validateClaveAcceso(buildClaveAcceso(input)) === true`.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/utils test --coverage` shows 100% statement coverage on `clave-acceso.ts`.
- All 5 documented fixtures match expected outputs.
- Negative-input fixtures each throw the typed error with the correct `code`.
- Contracts-side `validateClaveAcceso` and utils-side agree on 100 random builds.
- A consumer smoke test in `apps/api` passes.

## 6. Security considerations

- The 8-digit codigoNumerico is generated with `crypto.randomInt` — never `Math.random`.
- The function does not log anything (no Pino import).
- Errors carry no sensitive data — just the failing field name.
- The function does not allocate large strings or perform unbounded loops.

## 7. Deliverables

When TASKS-0022 is green, write `ai/reviews/0022-clave-acceso-generator-review.md` with:

1. **Summary** — what the algorithm does, with one-paragraph derivation citing the docs.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage report (line/branch %).
   - Fixture results.
   - Property-based test result (number of random inputs verified).
4. **Algorithm notes** — record the two special cases (`r=10→"1"`, `r=11→"0"`) and where in the docs they're defined.
5. **Deviations from spec/plan**.
6. **Risks observed** — e.g., docs ambiguity if any; cite the citation you used to disambiguate.
7. **Security review** — confirm no clock reads, no `Math.random`, no I/O, no logging.
8. **Suggested follow-ups** — none expected; if anything, mention adding a tiny CLI for ops.
9. **Sign-off checklist** — SPEC-0022 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; detailed review.

## 9. Exit condition

- All TASKS-0022 boxes ticked.
- Coverage gate met.
- Review file complete.

Begin.
