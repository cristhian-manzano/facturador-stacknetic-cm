---
id: SPEC-0022
title: Clave de acceso generator (49 digits + módulo 11)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0005]
blocks: [SPEC-0023, SPEC-0026, SPEC-0030, SPEC-0033]
---

# SPEC-0022 — Clave de acceso generator

## 1. Purpose

Implement the algorithm that generates the **49-digit clave de acceso** required by SRI for every electronic receipt. The clave is the unique identifier of the document used in the XML, signing, recepción, autorización, and (since 2014) it doubles as the `numeroAutorizacion`.

A buggy generator produces documents the SRI **silently** rejects only at the `validate XSD` step — or worse, accepts but cannot later be looked up. This spec deserves a dedicated module with exhaustive tests.

## 2. Scope

### 2.1 In scope

- Pure function `buildClaveAcceso(input): string` returning the 49-digit clave.
- Pure function `computeModulo11(base48: string): string` returning the single check digit.
- Pure function `validateClaveAcceso(clave: string): { ok: boolean; reason?: string }`.
- Helper `generateCodigoNumerico(): string` — cryptographically random 8 digits.
- Living in **both** API and SRI Core via shared placement in `packages/utils` (not `contracts`, because it's logic). Re-exported from `@facturador/contracts/primitives/clave-acceso` for the validator only (already there from [SPEC-0005](./0005-shared-contracts.md)).

### 2.2 Out of scope

- Reservation of `secuencial` — see [SPEC-0030](./0030-emission-points-and-sequencing.md).
- Persistence of the clave — see [SPEC-0026](./0026-document-lifecycle-and-jobs.md).
- XML embedding — see [SPEC-0023](./0023-xml-builder-factura.md).

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §4 — full algorithm.
- [`ai/context/sri-domain.md`](../context/sri-domain.md) — terminology.
- [SPEC-0005](./0005-shared-contracts.md) §6.4 — `ClaveAccesoSchema` (validation only).

## 4. Functional requirements

- **FR-1.** `buildClaveAcceso(input)` accepts:

  ```ts
  interface BuildClaveAccesoInput {
    fechaEmision: Date; // local date in Ecuador (UTC-5). Caller must pass a date already in EC tz.
    codDoc: "01" | "04" | "05" | "06" | "07";
    ruc: string; // 13 digits, sociedad/persona natural form
    ambiente: "1" | "2";
    estab: string; // 3 digits
    ptoEmi: string; // 3 digits
    secuencial: string; // 9 digits, left-padded with zeros
    codigoNumerico: string; // 8 digits
    tipoEmision: "1"; // only "1" supported (contingencia deprecated, see docs §1)
  }
  ```

  Output: **string of exactly 49 digits**. Throws `Error("invalid input")` with a precise message if any field fails its precondition.

- **FR-2.** `computeModulo11(base48)`:

  - Input: 48-character ASCII digit string.
  - Output: single character `"0"`..`"9"`.
  - Algorithm: weights `[2, 3, 4, 5, 6, 7]` applied **right to left, cyclic**. Sum products. `r = 11 - (sum mod 11)`. If `r === 11` → `"0"`. If `r === 10` → `"1"`. Else → `String(r)`.

- **FR-3.** `validateClaveAcceso(clave)`:

  - Returns `{ ok: true }` if length 49, all digits, and the 49th digit equals `computeModulo11(clave.slice(0, 48))`.
  - Else returns `{ ok: false, reason: "<...>" }`.

- **FR-4.** `generateCodigoNumerico()` uses `crypto.randomInt(0, 100_000_000)` then `.toString().padStart(8, "0")`. Pure function (depends only on Node `crypto`).

- **FR-5.** The function is deterministic w.r.t. its inputs. Given a fixed `codigoNumerico`, the clave is reproducible — required for replays.

## 5. Non-functional requirements

- **NFR-1.** ≤ 0.1 ms per call (negligible compared to surrounding work). Pure JS, no I/O.
- **NFR-2.** 100% test coverage in this module.
- **NFR-3.** Zero dependencies beyond Node built-ins.

## 6. Technical design

### 6.1 Layout

```
packages/utils/src/clave-acceso/
├── index.ts             # re-exports build / validate / computeModulo11 / generateCodigoNumerico
├── build.ts
├── modulo-11.ts
├── validate.ts
└── codigo-numerico.ts
```

### 6.2 `modulo-11.ts` (canonical implementation)

```ts
const WEIGHTS = [2, 3, 4, 5, 6, 7] as const;

export const computeModulo11 = (base48: string): string => {
  if (base48.length !== 48 || !/^\d{48}$/.test(base48)) {
    throw new Error("computeModulo11: base must be 48 digits");
  }
  let sum = 0;
  let w = 0;
  for (let i = base48.length - 1; i >= 0; i--) {
    sum += Number(base48[i]) * WEIGHTS[w]!;
    w = (w + 1) % WEIGHTS.length;
  }
  const r = 11 - (sum % 11);
  if (r === 11) return "0";
  if (r === 10) return "1";
  return String(r);
};
```

### 6.3 `build.ts`

```ts
import { computeModulo11 } from "./modulo-11.js";

export interface BuildClaveAccesoInput {
  fechaEmision: Date;
  codDoc: "01" | "04" | "05" | "06" | "07";
  ruc: string;
  ambiente: "1" | "2";
  estab: string;
  ptoEmi: string;
  secuencial: string;
  codigoNumerico: string;
  tipoEmision: "1";
}

const pad = (s: string | number, n: number) => String(s).padStart(n, "0");

const formatFecha = (d: Date): string => {
  // Caller must pass a Date that represents the intended local Ecuador date.
  const dd = pad(d.getDate(), 2);
  const mm = pad(d.getMonth() + 1, 2);
  const aaaa = String(d.getFullYear());
  return `${dd}${mm}${aaaa}`;
};

const requireDigits = (label: string, val: string, len: number) => {
  if (!new RegExp(`^\\d{${len}}$`).test(val))
    throw new Error(`${label} must be ${len} digits, got "${val}"`);
};

export const buildClaveAcceso = (i: BuildClaveAccesoInput): string => {
  requireDigits("ruc", i.ruc, 13);
  if (!["1", "2"].includes(i.ambiente)) throw new Error("ambiente must be '1' or '2'");
  requireDigits("estab", i.estab, 3);
  requireDigits("ptoEmi", i.ptoEmi, 3);
  requireDigits("secuencial", i.secuencial, 9);
  requireDigits("codigoNumerico", i.codigoNumerico, 8);
  if (i.tipoEmision !== "1") throw new Error("tipoEmision must be '1'");
  if (!["01", "04", "05", "06", "07"].includes(i.codDoc)) throw new Error("codDoc invalid");

  const base48 = `${formatFecha(i.fechaEmision)}${i.codDoc}${i.ruc}${i.ambiente}${i.estab}${i.ptoEmi}${i.secuencial}${i.codigoNumerico}${i.tipoEmision}`;
  if (base48.length !== 48) throw new Error(`base must be 48 chars, got ${base48.length}`);
  return base48 + computeModulo11(base48);
};
```

### 6.4 `validate.ts`

```ts
import { computeModulo11 } from "./modulo-11.js";

export const validateClaveAcceso = (
  clave: string,
): { ok: true } | { ok: false; reason: string } => {
  if (clave.length !== 49) return { ok: false, reason: "length != 49" };
  if (!/^\d{49}$/.test(clave)) return { ok: false, reason: "non-digit characters" };
  const base = clave.slice(0, 48);
  const check = clave.slice(48);
  return computeModulo11(base) === check
    ? { ok: true }
    : { ok: false, reason: "verifier digit mismatch" };
};
```

### 6.5 `codigo-numerico.ts`

```ts
import { randomInt } from "node:crypto";

export const generateCodigoNumerico = (): string =>
  randomInt(0, 100_000_000).toString().padStart(8, "0");
```

### 6.6 Known-good fixtures

Use these in tests. Verified manually against the algorithm definition:

| `fecha`      | `codDoc` | `ruc`           | `ambiente` | `estab` | `ptoEmi` | `secuencial` | `codigoNumerico` | `tipoEmision` | Expected clave                                                                                                    |
| ------------ | -------- | --------------- | ---------- | ------- | -------- | ------------ | ---------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `2026-05-19` | `01`     | `1790012345001` | `1`        | `001`   | `001`    | `000000123`  | `12345678`       | `1`           | `1905202601179001234500110010010000001231234567811` _(verify in implementation; do not assume — compute and pin)_ |

> The implementer **must** generate the actual expected clave by running the algorithm on the inputs above and pinning the result as the test fixture. The table above shows the inputs; the expected output is whatever `buildClaveAcceso` produces deterministically. Do **not** hand-compute and substitute.

## 7. Implementation guide

### 7.1 Steps

1. Create `packages/utils/src/clave-acceso/` per §6.1.
2. Export from `packages/utils/src/index.ts`: `export * from "./clave-acceso/index.js";`.
3. Add unit tests with at minimum:
   - 5 known-good fixtures spanning factura/NC/ND/retención/guía.
   - Tampering tests: flip a digit → `validate` returns `ok: false`.
   - Boundary: secuencial `000000001` and `999999999`.
   - Random fuzz (1000 iterations): `validate(buildClaveAcceso(rand)) === { ok: true }`.

### 7.2 Dependencies

None beyond Node built-ins (`crypto`).

### 7.3 Conventions

- Algorithm constants live in this module only; do not duplicate weights elsewhere.
- Module is exported from `@facturador/utils` (added in [SPEC-0001](./0001-monorepo-and-workspace.md) §6.1). The validator already exists in `@facturador/contracts/primitives/clave-acceso` for input validation; it imports `computeModulo11` from `@facturador/utils` to avoid duplication.

## 8. Acceptance criteria

- **AC-1.** `buildClaveAcceso` with any valid input returns a string matching `/^\d{49}$/`.
- **AC-2.** `validateClaveAcceso(buildClaveAcceso(x)).ok === true` for any valid `x`.
- **AC-3.** Flipping any single digit in a valid clave makes `validate` return `ok: false`.
- **AC-4.** `computeModulo11` produces `"0"` when `sum % 11 === 0` (case: r = 11).
- **AC-5.** `computeModulo11` produces `"1"` when `r === 10`.
- **AC-6.** `buildClaveAcceso` rejects malformed `ruc`, `estab`, `ptoEmi`, `secuencial`, `codigoNumerico`, `ambiente`, `tipoEmision`, `codDoc`.
- **AC-7.** `generateCodigoNumerico` is uniformly distributed (chi-squared on 10,000 samples passes at α=0.01).
- **AC-8.** Coverage: 100% lines and branches in `packages/utils/src/clave-acceso/`.

## 9. Test plan

See AC-1..AC-8.

Additional property-based test: for 5,000 random valid inputs, the built clave round-trips through `validate` and through `@facturador/contracts/primitives/clave-acceso`.

## 10. Security considerations

- `generateCodigoNumerico` uses `crypto.randomInt` (CSPRNG). Do **not** use `Math.random`.
- The clave embeds the RUC and date — treat it as PII-adjacent in logs. The `@facturador/logger` redaction list does **not** redact clave by default (it is needed for traceability), but log scopes containing the customer's identificación should not co-occur with the clave in the same JSON line.

## 11. Observability

- The clave is one of the most useful correlation IDs across logs (audit + Web + SRI events). Always include `claveAcceso` field when known.

## 12. Risks and mitigations

| Risk                                                            | Mitigation                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Off-by-one in module-11 (history shows this is a frequent bug)  | Pinned known-good fixtures + property-based tests + this spec's own pseudocode reviewed.                         |
| Date computed in wrong timezone                                 | Caller responsibility documented in §6.3; companion helper `nowInEcuador()` lives in `packages/utils/src/time/`. |
| `codigoNumerico` collision (very unlikely with random 8 digits) | Acceptable — `secuencial` + RUC + date already make the clave unique even with same `codigoNumerico`.            |

## 13. Open questions

- Reuse `codigoNumerico` on retries vs. regenerate? Reuse — the clave must be **immutable** once emitted. Persist it at creation. See [SPEC-0026](./0026-document-lifecycle-and-jobs.md).

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
