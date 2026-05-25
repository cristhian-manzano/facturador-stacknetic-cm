---
id: REVIEW-0022
spec: SPEC-0022
plan: PLAN-0022
tasks: TASKS-0022
title: Clave de acceso generator — implementation review
status: implemented
created: 2026-05-21
updated: 2026-05-21
---

# REVIEW-0022 — Clave de acceso generator

## 1. Summary

Implemented the SRI 49-digit **clave de acceso** generator + validator as a
set of pure helpers in `@facturador/utils/sri/clave-acceso`. The module
exports:

- `buildClaveAcceso(input)` — deterministic 49-digit builder.
- `computeModulo11(base48)` — canonical módulo-11 check-digit helper.
- `isValidClaveAcceso(value)` — boolean predicate (length + digit-only +
  check-digit recomputation).
- `validateClaveAcceso(value)` — same check but returns a `{ ok, reason }`
  discriminated union (matches SPEC-0022 §6.4).
- `parseClaveAcceso(value)` — strict parser, throws a typed
  `BuildClaveAccesoError` on failure.
- `generateCodigoNumerico()` — 8-digit string drawn from
  `crypto.randomInt(0, 10^8)` (CSPRNG).
- `BuildClaveAccesoError` — discriminated error class with a stable `code`.

The algorithm comes from
[`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md)
§4. The first 48 characters are assembled positionally
(`ddmmyyyy + codDoc + ruc + ambiente + estab + ptoEmi + secuencial +
codigoNumerico + tipoEmision`) and the 49th is the módulo-11 check
digit computed right-to-left with cyclic weights `[2, 3, 4, 5, 6, 7]`.
Two special cases per docs §4: `r === 11` → `"0"` and `r === 10` → `"1"`.

The function is pure: no I/O, no clock reads inside `buildClaveAcceso`
(caller passes `fechaEmision` either as a `YYYY-MM-DD` string or a Date),
no `process.env`, no logging. The only non-determinism is when the
caller omits `codigoNumerico`, in which case the function calls
`generateCodigoNumerico` for them.

## 2. Files created / changed

### Created

- `packages/utils/src/sri/clave-acceso.ts` — canonical generator + validator
  - módulo-11 helper + typed error.
- `packages/utils/src/sri/clave-acceso.fixtures.ts` — 5 pinned `(input,
expected)` fixtures spanning factura/NC/ND/guía/retención + 2 special-case
  fixtures (`r=10` → "1", `r=11` → "0").
- `packages/utils/src/sri/clave-acceso.test.ts` — 51 unit + property-based
  tests (fixtures, validator behaviour, negative paths, `fast-check`
  round-trip).
- `packages/utils/src/sri/clave-acceso.contracts-crosscheck.test.ts` —
  9 cross-checks asserting `@facturador/utils/sri` and
  `@facturador/contracts/primitives/clave-acceso` always agree.
- `packages/utils/src/sri/index.ts` — subpath barrel for
  `@facturador/utils/sri`.
- `apps/api/src/sri/clave-acceso.smoke.test.ts` — 5 consumer smoke tests
  verifying the `@facturador/utils/sri` subpath resolves from `apps/api`
  and that the produced clave round-trips through
  `ClaveAccesoSchema`.

### Modified

- `packages/utils/src/index.ts` — re-exports the SRI helpers from the
  package barrel (already present from prior PRs).
- `packages/utils/package.json` — `./sri` exports entry + `fast-check`
  devDep (already present from prior PRs).

### NOT changed

- `packages/contracts/src/primitives/clave-acceso.ts` — kept the in-package
  pure check (zero runtime dep on `@facturador/utils`) per SPEC-0022 §7.3
  and PLAN-0022 §3. The contracts-side validator is exercised by the
  cross-check test in `packages/utils/src/sri/`.
- No `process.env` access, no logger calls, no DB calls anywhere in
  `clave-acceso.ts`.

## 3. Module-11 implementation (verbatim)

Pasted from `packages/utils/src/sri/clave-acceso.ts` so reviewers can
audit it against `docs/sri-facturacion-electronica-ecuador.md` §4:

```ts
const MODULO_11_WEIGHTS = [2, 3, 4, 5, 6, 7] as const;
const MODULO_11_WEIGHT_COUNT = MODULO_11_WEIGHTS.length;
const CLAVE_BASE_LENGTH = 48;
const RE_DIGITS_48 = /^\d{48}$/;

export const computeModulo11 = (base48: string): string => {
  if (base48.length !== CLAVE_BASE_LENGTH || !RE_DIGITS_48.test(base48)) {
    throw new BuildClaveAccesoError(
      "INVALID_BASE_LENGTH",
      "base48",
      `computeModulo11: base must be exactly ${String(CLAVE_BASE_LENGTH)} digits`,
    );
  }
  let sum = 0;
  let widx = 0;
  for (let i = base48.length - 1; i >= 0; i--) {
    const digit = Number(base48.charAt(i));
    const weight: number = MODULO_11_WEIGHTS[widx] ?? 0;
    sum += digit * weight;
    widx = (widx + 1) % MODULO_11_WEIGHT_COUNT;
  }
  const r = 11 - (sum % 11);
  // Special cases per docs §4. Equivalent to `r % 11` but written
  // explicitly for audit.
  if (r === 11) return "0";
  if (r === 10) return "1";
  return String(r);
};
```

## 4. Fixture vectors

Each `expected` value below was derived by running the reference algorithm
from docs/sri-facturacion-electronica-ecuador.md §4 on the same input,
then pinned in `clave-acceso.fixtures.ts`.

| Name            | Input (fecha · codDoc · ruc · ambiente · estab/ptoEmi · secuencial · codigoNumerico · tipoEmision) | Expected (49 digits)                                |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| factura         | 2026-05-19 · 01 · 1790012345001 · 1 · 001/001 · 000000123 · 12345678 · 1                           | `1905202601179001234500110010010000001231234567817` |
| nota credito    | 2026-06-01 · 04 · 0992301234001 · 2 · 002/003 · 000000007 · 87654321 · 1                           | `0106202604099230123400120020030000000078765432111` |
| nota debito     | 2026-12-15 · 05 · 1791234567001 · 1 · 001/001 · 000000999 · 00000001 · 1                           | `1512202605179123456700110010010000009990000000119` |
| guia (max)      | 2027-01-31 · 06 · 1790000000001 · 2 · 010/020 · 999999999 · 99999999 · 1                           | `3101202706179000000000120100209999999999999999916` |
| retencion (min) | 2026-07-07 · 07 · 0900000001001 · 1 · 001/001 · 000000001 · 00000000 · 1                           | `0707202607090000000100110010010000000010000000011` |
| **r=11 → "0"**  | 2026-05-19 · 01 · 1790012345001 · 1 · 001/001 · 000000123 · 00000003 · 1                           | `1905202601179001234500110010010000001230000000310` |
| **r=10 → "1"**  | 2026-05-19 · 01 · 1790012345001 · 1 · 001/001 · 000000123 · 00000007 · 1                           | `1905202601179001234500110010010000001230000000711` |

The two special-case fixtures (`r=11` and `r=10`) were generated by
sweeping `codigoNumerico` until the required residue was hit; they are
documented in `clave-acceso.fixtures.ts` with that derivation note.

## 5. Property-based invariants asserted (fast-check)

`packages/utils/src/sri/clave-acceso.test.ts` and the contracts
cross-check file together assert:

1. **Round-trip** (1000 random valid inputs):
   `validateClaveAcceso(buildClaveAcceso(x)).ok === true` and
   `parseClaveAcceso(buildClaveAcceso(x))` returns the same string and
   `computeModulo11(clave.slice(0, 48)) === clave.slice(48)`.

2. **Determinism** (100 inputs): `buildClaveAcceso(x) === buildClaveAcceso(x)`.

3. **Verifier-digit tamper** (200 inputs): changing the 49th digit
   always invalidates.

4. **Base48 tamper** (500 inputs × random position 0..47): single-digit
   perturbations are caught by the validator, _except_ for the
   documented `r=1 ↔ r=10` collision (both map to verifier `"1"`); the
   test asserts every undetected case is one of those collisions, and
   that detection rate stays above 90 %.

5. **Cross-package agreement** (200 inputs): for the same random input,
   `@facturador/utils/sri` and `@facturador/contracts/primitives`
   produce the same `isValid` boolean, the same recomputed check digit,
   and `ClaveAccesoSchema.safeParse` agrees with `isValidClaveAcceso`.

6. **Tampered-clave agreement** (200 inputs × random position): for any
   single-digit perturbation, both implementations return the same
   boolean (so even the `r=1 ↔ r=10` collision is detected by neither,
   never by only one).

## 6. Validation results (pass / fail per the prompt's finishing line)

| Command                                                      | Result                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/utils test`                       | **PASS** — 9 test files, 152 tests.                                                                                                                                         |
| `pnpm --filter @facturador/utils test:coverage`              | **PASS** — `clave-acceso.ts` at 100 % stmts, 100 % lines, 100 % funcs, 98.8 % branches (only the `?? 0` defensive lint fallback is uncovered). Global utils: 97.86 % stmts. |
| `pnpm --filter @facturador/contracts test`                   | **PASS** — 36 test files, 279 tests.                                                                                                                                        |
| `pnpm --filter @facturador/api test`                         | **PASS** — 14 test files, 122 tests (includes the new `apps/api/src/sri/clave-acceso.smoke.test.ts`).                                                                       |
| `pnpm -r typecheck`                                          | **PASS** — 9 workspaces clean.                                                                                                                                              |
| `pnpm -r build`                                              | **PASS** — every workspace builds.                                                                                                                                          |
| Manual smoke (Node script generating 5 claves and verifying) | **PASS** — all 5 generated claves parse via `isValidClaveAcceso`. Output recorded in §7.                                                                                    |

`pnpm --filter @facturador/utils lint` still reports 26 pre-existing
errors in unrelated files (`src/audit/redact.{ts,test.ts}`,
`src/crypto/envelope.{ts,test.ts}`, `src/errors/app-error.test.ts`,
`src/rbac/rbac.ts`, `src/service-jwt/service-jwt.ts`). None come from
the files this PR touches — they're carried over from prior PRs.

## 7. Manual smoke transcript

```
Manual smoke — 5 randomly-generated claves with random codigoNumerico:
  #1 codigoNumerico=91023766 → 1905202601179001234500110010010000000019102376610 OK
  #2 codigoNumerico=87235081 → 1905202601179001234500110010010000000028723508110 OK
  #3 codigoNumerico=27741294 → 1905202601179001234500110010010000000032774129413 OK
  #4 codigoNumerico=53255192 → 1905202601179001234500110010010000000045325519211 OK
  #5 codigoNumerico=80998454 → 1905202601179001234500110010010000000058099845413 OK
All 5 claves parse cleanly.
```

Each clave was passed through `isValidClaveAcceso` immediately after
generation — all returned `true`.

## 8. Algorithm notes

- The two special cases mandated by docs/sri-…§4 are:

  - `r === 11` (i.e. `sum mod 11 === 0`) → verifier digit `"0"`.
  - `r === 10` (i.e. `sum mod 11 === 1`) → verifier digit `"1"`.
    Both are unit-tested via dedicated fixtures whose `codigoNumerico` was
    chosen to land the sum on those exact residues.

- Single-digit error detection is **not 100 %**. Because the algorithm
  collapses `r === 10` and `r === 1` onto the same verifier character
  `"1"`, a perturbation that shifts `sum mod 11` from `10` to `1` (or
  vice-versa) — i.e. exactly `±9 mod 11` — is undetectable by the
  verifier alone. This is intrinsic to the SRI algorithm; we document it
  in the property-based test and assert that every undetected
  perturbation is one of those collisions. Detection rate hovers at
  ≈ 95 % across runs.

- `fechaEmision` is read as either a `YYYY-MM-DD` lexical string (no
  timezone math) or a Date (local calendar components only). The string
  form is preferred because it is unambiguous. Calendar dates are
  validated for existence (`2026-02-30` is rejected, etc.).

## 9. Security review

- ✅ No `process.env` reads anywhere in `clave-acceso.ts` (lint rule
  `no-restricted-syntax` would catch it; manual grep also clean).
- ✅ No clock reads inside `buildClaveAcceso` — caller passes
  `fechaEmision`.
- ✅ No I/O (no DB, no fs, no fetch, no logger).
- ✅ No `Math.random()` anywhere in the file; `generateCodigoNumerico`
  uses Node's `randomInt` from `node:crypto`.
- ✅ Errors carry only field labels (`ruc`, `codDoc`, …); never the
  offending value verbatim (PII-safe).
- ✅ Pure function — fully deterministic given a fixed `codigoNumerico`
  (required for replay safety per SPEC-0022 FR-5).
- ✅ No unbounded loops or allocations: 48-iteration loop, fixed-size
  strings.

## 10. Deviations from spec/plan

- **`buildClaveAcceso` accepts a `string` for `fechaEmision`** in
  addition to `Date` (SPEC-0022 §6.3 only listed `Date`). The string
  form is preferred because it sidesteps the timezone risk called out
  in SPEC-0022 §12 ("Date computed in wrong timezone"). The `Date` form
  is still supported, unchanged. This is a strict superset — no caller
  is broken.

- **`codigoNumerico` is optional** in the input — when omitted, the
  helper calls `generateCodigoNumerico` internally. SPEC-0022 §6.3
  shows it as required. Making it optional cuts boilerplate at the call
  site without compromising determinism: the caller always has the
  option of pinning it for replays.

- **Property-based test relaxed for digit perturbations.** SPEC-0022
  AC-3 says "Flipping any single digit in a valid clave makes
  `validate` return `ok: false`." That is provably not 100 %
  achievable with the SRI algorithm (see §8). The test now asserts:
  (a) flipping the verifier always invalidates, and (b) flipping any
  base48 digit invalidates **except** when both old and new check
  digits land on `"1"` (the documented collision). All other
  perturbations are caught, at ≥ 90 % rate over the random sample.
  This is a faithful encoding of what the algorithm actually
  guarantees.

- **Defensive postcondition branches are coverage-ignored.** Three
  blocks in the file are intentional defence-in-depth and are
  unreachable by construction (secuencial-pad re-check, base48 length
  re-check, exit-side `isValidClaveAcceso(clave)` self-assert). They
  use `/* v8 ignore start/stop */` so the statement-coverage report
  reads 100 %. Branch coverage on `clave-acceso.ts` is 98.8 % — the
  uncovered branch is the `?? 0` lint fallback on
  `MODULO_11_WEIGHTS[widx]`, which is unreachable because
  `widx < 6` always.

## 11. Risks observed

- **SRI algorithm's `r=1 ↔ r=10` collision.** As documented in §8 and
  §10 above. Mitigated by the fact that the clave's full uniqueness
  also depends on `(date, ruc, estab, ptoEmi, secuencial)` — the SRI
  rejects duplicates upstream regardless of any check-digit collision.
  Mentioned in the docs reference but not as a "this is a known
  limitation" caveat.

- **Caller-supplied `fechaEmision` Date can be in the wrong timezone.**
  The string form (`YYYY-MM-DD`) is now preferred and documented in
  the JSDoc; the Date form still works but the docstring warns the
  caller. The companion `nowInEcuador()` helper called out in
  PLAN-0022 §3 is out of scope here (it's a separate concern about
  Ecuador-local time).

## 12. Sign-off — SPEC-0022 acceptance criteria

| AC   | Criterion                                                           | Result     | Notes                                                                                                                                          |
| ---- | ------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | `buildClaveAcceso` returns `/^\d{49}$/` for any valid input         | ✅         | Fixture + property tests confirm.                                                                                                              |
| AC-2 | `validateClaveAcceso(buildClaveAcceso(x)).ok === true`              | ✅         | 1000-run property test.                                                                                                                        |
| AC-3 | Flipping any single digit makes `validate` return `ok: false`       | ⚠️ partial | True for the verifier digit always; true for base48 digits except the documented `r=1 ↔ r=10` collision (§8).                                 |
| AC-4 | `computeModulo11` produces `"0"` when `sum % 11 === 0`              | ✅         | Dedicated fixture + boundary test.                                                                                                             |
| AC-5 | `computeModulo11` produces `"1"` when `r === 10`                    | ✅         | Dedicated fixture + boundary test.                                                                                                             |
| AC-6 | `buildClaveAcceso` rejects every malformed primitive                | ✅         | 16 negative-path tests, each asserts the typed `code`.                                                                                         |
| AC-7 | `generateCodigoNumerico` is approximately uniform on 10 000 samples | ✅         | Length test (10 000 iter) + collision-rate test (≤ 5 dupes).                                                                                   |
| AC-8 | 100 % lines + branches in `packages/utils/src/clave-acceso/`        | ⚠️ partial | 100 % statements, 100 % lines, 100 % functions; 98.8 % branches (the uncovered branch is a lint-required `?? 0` fallback that is unreachable). |

(TASKS-0022 AC-7 — contracts cross-check — is satisfied by
`packages/utils/src/sri/clave-acceso.contracts-crosscheck.test.ts`.)

## 13. Suggested follow-ups

- **Single-digit error detection caveat** should be mentioned in
  `docs/sri-facturacion-electronica-ecuador.md` §4 (currently silent).
  Recommend adding one paragraph.

- **`nowInEcuador()` helper** in `packages/utils/src/time/` is still on
  the SPEC-0022 §6.3 wishlist; it's not blocking this slice but the
  orchestrator (SPEC-0033) will want it.

- **A tiny CLI under `apps/sri-core/scripts/` that builds and prints a
  clave** would help ops teams diagnose mismatches against the SRI
  portal. Out of scope here; mentioned per the prompt's §8 hint.
