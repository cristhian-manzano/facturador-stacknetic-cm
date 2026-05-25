---
id: PLAN-0022
spec: SPEC-0022
title: Clave de acceso generator — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0022 — Clave de acceso generator

> Implementation plan for [SPEC-0022](../specs/0022-clave-acceso-generator.md). Depends on PLAN-0005.

## 1. Goal

Provide a single, pure, deterministic implementation of the **49-digit clave de acceso** algorithm used by SRI:

- `buildClaveAcceso(fields)` → 49-digit string.
- `computeModulo11(digits)` → check digit per SRI rules.
- `validateClaveAcceso(s)` → boolean (used by the contract refine in SPEC-0005).
- `generateCodigoNumerico()` → 8-digit random component.

After this slice the function is consumed by SPEC-0023 (XML builder) and SPEC-0033 (orchestrator), and by `@facturador/contracts` for refines.

## 2. Inputs

- [SPEC-0022](../specs/0022-clave-acceso-generator.md) — authoritative.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — algorithm definition.
- [ai/context/glossary.md](../context/glossary.md) — field names.

## 3. Architecture decisions

| Decision                                                                                                                                         | Rationale                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Live in `@facturador/utils/sri/clave-acceso.ts`.                                                                                                 | Shared by sri-core + api + contracts via subpath. |
| Pure functions; no I/O; no globals.                                                                                                              | Easy unit tests; deterministic.                   |
| `computeModulo11` accepts the **first 48 digits**, returns the **49th** check digit.                                                             | Matches SRI spec.                                 |
| Weighting: `[2,3,4,5,6,7]` repeated cyclically, applied **right-to-left** over the input digits.                                                 | Per `docs/sri-...`.                               |
| Special cases: result digit `11 → "0"`, `10 → "1"`.                                                                                              | Per SRI.                                          |
| `generateCodigoNumerico()` uses `crypto.randomInt(0, 99_999_999)` and zero-pads to 8 chars.                                                      | Cryptographically secure source.                  |
| `buildClaveAcceso({ fechaEmision, codDoc, ruc, ambiente, estab, ptoEmi, secuencial, codigoNumerico, tipoEmision })` returns the 49-digit string. | Single typed entry point.                         |
| Validate input shapes inside the function (lengths and digit-only) and throw a typed `BuildClaveAccesoError` on invalid input.                   | Defensive at the boundary.                        |

## 4. Phases

### Phase 1 — Pure helpers

`packages/utils/src/sri/clave-acceso.ts`:

- `computeModulo11(digits: string): string`.
- `validateClaveAcceso(s: string): boolean`.
- `generateCodigoNumerico(): string`.

`buildClaveAcceso(input)`:

1. Validate inputs (length, digit-only, allowed enums).
2. Format fechaEmision into `ddmmyyyy`.
3. Concatenate per SRI spec:
   ```
   ddmmyyyy(8) + codDoc(2) + ruc(13) + ambiente(1) + estab(3) + ptoEmi(3) + secuencial(9) + codigoNumerico(8) + tipoEmision(1) = 48 digits
   ```
4. Compute check digit; append → 49 digits.
5. Assert `validateClaveAcceso(result) === true`.

### Phase 2 — Tests

- Property-based: pick a known seed, build a clave, run `validateClaveAcceso` → true. Modify one digit → false.
- Table-driven: 5 documented fixtures with input → expected 49-digit string.
- Edge cases:
  - `secuencial = "000000001"` (zero padding).
  - `codigoNumerico = "00000000"` accepted (mod-11 must still validate).
  - `fechaEmision = "2026-02-29"` (invalid date) → throws.
  - `ruc` not 13 digits → throws.
  - `codDoc not in ["01","04","05","06","07"]` → throws.
- `generateCodigoNumerico`: 10_000 invocations, each ∈ [0,99_999_999], all 8 chars long.

### Phase 3 — Integration with contracts

`packages/contracts/src/primitives/clave-acceso.ts` consumes `validateClaveAcceso` via `@facturador/utils/sri` (or re-implements internally to keep contracts I/O-free). Decision: contracts package re-implements the **pure check** to keep zero-dep; utils package owns the **build** function (which the API uses).

### Phase 4 — Consumer wiring

- `apps/api` and `apps/sri-core` add dep `@facturador/utils`.
- `apps/api/src/invoices/builders.ts` will call `buildClaveAcceso` in SPEC-0033.

## 5. Risks & mitigations

| Risk                                                                    | Mitigation                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Misreading the SRI spec on weighting direction or special-case mapping. | 5 documented fixtures from official sources; tests cite docs.                              |
| `secuencial` not zero-padded by caller.                                 | `buildClaveAcceso` accepts a number or string; pads to 9 chars; rejects > 9.               |
| `crypto.randomInt` exhaustion under load.                               | Negligible; documented if profiled later.                                                  |
| Date parsing pitfalls (TZ).                                             | `fechaEmision` is a local-date string `YYYY-MM-DD`; we only consume year/month/day fields. |

## 6. Validation strategy

- 100% statement coverage on this file.
- All fixtures pass.
- All forced-error paths throw the typed error.

## 7. Exit criteria

- All SPEC-0022 ACs pass.
- Shared by contracts (refine) and orchestrator (build).
- No I/O.

## 8. Out of scope

- Storing claveAcceso anywhere — that's SPEC-0033 and SPEC-0020.
- Reissuance secuencial burning — SPEC-0030.
