---
id: TASKS-0022
spec: SPEC-0022
plan: PLAN-0022
title: Clave de acceso generator — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0022 — Clave de acceso generator

> Checklist for [SPEC-0022](../specs/0022-clave-acceso-generator.md) + [PLAN-0022](../plans/0022-clave-acceso-generator-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No I/O; no `process.env`; no clock reads inside `buildClaveAcceso` (caller passes `fechaEmision`).
- ❌ No `Math.random()`. Only `crypto.randomInt`.
- ❌ No truncation or silent coercion of inputs. Invalid input throws.
- ✅ 100% statement coverage on `clave-acceso.ts`.
- ✅ Algorithm verified by at least 5 documented fixtures (sourced from `docs/sri-facturacion-electronica-ecuador.md`).

## 1. Implementation

- [ ] **1.1** Create `packages/utils/src/sri/clave-acceso.ts` exporting:

  - `BuildClaveAccesoInput` type with strict shapes.
  - `computeModulo11(digits48: string): string`.
  - `validateClaveAcceso(s: string): boolean`.
  - `generateCodigoNumerico(): string`.
  - `buildClaveAcceso(input): string`.
  - `class BuildClaveAccesoError extends Error` with a `code: "INVALID_RUC"|"INVALID_FECHA"|"INVALID_AMBIENTE"|...`.
    **Validate**: typecheck clean.

- [ ] **1.2** Algorithm details for `computeModulo11`:

  - Reject if `digits48.length !== 48` or non-digit.
  - Weighting `[2,3,4,5,6,7]`, right-to-left, cyclically.
  - `result = (11 - (sum % 11)) % 11` → if `result === 10`, return `"1"`; if `result === 11`, return `"0"` (special case per spec; equivalent to `result % 11`); else return `result.toString()`.
  - Document the exact lines in code with a docstring citation to `docs/sri-...`.
    **Validate**: unit test against fixtures.

- [ ] **1.3** `validateClaveAcceso(s)`:

  - Returns true iff `s.length === 49`, all digits, AND `computeModulo11(s.slice(0,48)) === s[48]`.
    **Validate**: tests below.

- [ ] **1.4** `generateCodigoNumerico()`:

  - `crypto.randomInt(0, 100_000_000).toString().padStart(8, "0")`.
  - Returns 8-character string.
    **Validate**: 10,000-iteration loop test asserts `/^\d{8}$/`.

- [ ] **1.5** `buildClaveAcceso(input)`:
  - Validates: `fechaEmision` matches `YYYY-MM-DD` and is a real date; `codDoc ∈ {"01","04","05","06","07"}`; `ruc.length === 13` digits; `ambiente ∈ {"1","2"}`; `estab.length === 3` digits; `ptoEmi.length === 3` digits; `secuencial` accepts string or number, padded to 9 digits, rejects > 9 digits; `codigoNumerico.length === 8`; `tipoEmision === "1"`.
  - Builds the 48-digit string (date as `ddmmyyyy`).
  - Appends check digit.
  - Asserts `validateClaveAcceso(result)` before returning.
    **Validate**: all of §2.

## 2. Tests

- [ ] **2.1** Fixture set in `clave-acceso.fixtures.ts`: at least 5 entries `{ input, expected }` taken from documented examples; document the source link inline.
      **Validate**: each fixture builds to `expected`.

- [ ] **2.2** `computeModulo11` exhaustive boundary tests for the special-case branches (a `digits48` that produces `result === 10` and one that produces `result === 11`).
      **Validate**: pass.

- [ ] **2.3** `validateClaveAcceso`:

  - Returns `true` for the 5 fixtures.
  - Returns `false` for each fixture with the last digit incremented mod 10.
  - Returns `false` for inputs of length 48 or 50.
  - Returns `false` for inputs containing non-digit.
    **Validate**: pass.

- [ ] **2.4** `buildClaveAcceso` negative paths:

  - `ruc.length === 10` (cédula) → throws `INVALID_RUC`.
  - `fechaEmision === "2026-02-30"` → throws `INVALID_FECHA`.
  - `codDoc === "99"` → throws `INVALID_COD_DOC`.
  - `ambiente === "3"` → throws `INVALID_AMBIENTE`.
  - `secuencial === "1234567890"` (10 digits) → throws `INVALID_SECUENCIAL`.
    **Validate**: each throws the typed error with the right `code`.

- [ ] **2.5** `generateCodigoNumerico` distribution sanity:
  - Run 10,000 times; count duplicates; expect very few (probabilistic; tolerate ≤ 5).
    **Validate**: pass.

## 3. Coverage gate

- [ ] **3.1** `pnpm --filter @facturador/utils test --coverage` shows 100% statements on `clave-acceso.ts`.
      **Validate**: pass.

## 4. Contracts wiring

- [ ] **4.1** `packages/contracts/src/primitives/clave-acceso.ts` uses an inline pure check (no `@facturador/utils` runtime dep), implemented from the same algorithm. The implementation is identical and a unit test cross-checks 100 randomly built strings — both functions agree on validity.
      **Validate**: cross-check test passes for 100 random builds.

## 5. Consumer smoke

- [ ] **5.1** In `apps/api/src/sri/clave-acceso.smoke.test.ts`, import `buildClaveAcceso`, generate a 49-digit string from a known input, assert format and that `validateClaveAcceso` returns true.
      **Validate**: `pnpm --filter @facturador/api test` exits 0.

## 6. Acceptance criteria

- [ ] AC-1: `computeModulo11` correct for the documented fixtures (including `10`→`"1"` and `11`→`"0"` special cases).
- [ ] AC-2: `validateClaveAcceso` accepts known good strings and rejects single-digit perturbations.
- [ ] AC-3: `buildClaveAcceso` is deterministic given fixed input + `codigoNumerico`.
- [ ] AC-4: `generateCodigoNumerico` uses `crypto.randomInt` and produces 8-char strings.
- [ ] AC-5: All negative paths throw a typed `BuildClaveAccesoError` with a clear `code`.
- [ ] AC-6: 100% statement coverage on this file.
- [ ] AC-7: Contracts package's pure check agrees with utils for random inputs.

## 7. Definition of Done

- All boxes ticked.
- Coverage gate met.
- Review file `ai/reviews/0022-clave-acceso-generator-review.md` written.
