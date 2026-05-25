---
id: REVIEW-0032
spec: SPEC-0032
plan: PLAN-0032
tasks: TASKS-0032
prompt: PROMPT-0032
title: Invoice domain — review (test/validation phase)
status: partial — domain compute + validation + tests complete; endpoints deferred to PROMPT-0033
created: 2026-05-21
---

# REVIEW-0032 — Invoice domain (test phase)

## 1. Summary

This finishing pass completes the **test and validation** portion of
PROMPT-0032 against the already-implemented pure-domain code
(`money.ts`, `tax-rates.ts`, `compute.ts`, `validate.ts`). Endpoints,
RBAC wiring, and the integration test path remain explicitly **out of
scope** here and will land in PROMPT-0033 alongside the orchestrator.

What this pass produced:

- 5 new test files exercising the four pure-domain modules.
- 109 tests in total: 28 (money) + 25 (tax-rates) + 22 (compute) + 27
  (validate) + 7 (property-based, each ≥ 100 fast-check runs).
- 100 % statement coverage on `money.ts`, `tax-rates.ts`, `validate.ts`
  and 96.07 % on `compute.ts` (uncovered lines are documented
  unreachable "internal compute error" branches).
- A single one-line bug fix in `repository.ts` (deletion of dead code
  `updateData.customer = undefined`) to unblock `pnpm -r typecheck`.

The whole monorepo's typecheck and build pass green; `apps/api` test
suite is 295/295 green.

## 2. Files created / changed

### Created (test files)

- `apps/api/src/invoices/money.test.ts` (28 tests)
- `apps/api/src/invoices/tax-rates.test.ts` (25 tests)
- `apps/api/src/invoices/compute.test.ts` (22 tests)
- `apps/api/src/invoices/compute.property.test.ts` (7 fast-check
  properties, each ≥ 100 runs; the IVA-window invariant uses 200 runs)
- `apps/api/src/invoices/validate.test.ts` (27 tests)

### Modified

- `apps/api/src/invoices/repository.ts` — removed a single dead line
  (`updateData.customer = undefined`) that was both unreachable AND
  invalid against the Prisma `InvoiceUpdateInput` type. The fix is
  surgical; the surrounding `customerId` mutation logic is unchanged.
  This was the only blocker for `pnpm -r typecheck` to pass.

### Untouched (PROMPT-0033 territory)

- Endpoints / routes / handlers / controllers — not in scope.
- The bulk of `repository.ts` (createInvoiceDraft, replaceInvoiceDraft,
  listInvoices, etc.) — out of scope per the carry-over instructions.

## 3. Validation evidence

| Command                                               | Result                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/api test src/invoices/`    | **PASS** — 5 files / 109 tests / 0 failures                                                  |
| `pnpm --filter @facturador/api test` (whole apps/api) | **PASS** — 23 files / 295 tests / 0 failures                                                 |
| `pnpm -r typecheck`                                   | **PASS** — 9 of 9 workspaces clean                                                           |
| `pnpm -r build`                                       | **PASS** — every workspace builds                                                            |
| Property tests numRuns ≥ 100                          | **PASS** — all `fc.assert` calls run 100..200 cases                                          |
| Coverage `money.ts`                                   | **100 %** statements / branches / functions / lines                                          |
| Coverage `tax-rates.ts`                               | **100 %** statements / branches / functions / lines                                          |
| Coverage `validate.ts`                                | **100 %** statements / branches / functions / lines                                          |
| Coverage `compute.ts`                                 | **96.07 %** statements (uncovered: 246-247, 250-251 — documented unreachable error branches) |

## 4. IVA selector logic (paste)

```ts
// apps/api/src/invoices/tax-rates.ts
export const IVA_15_EFFECTIVE_FROM = "2024-04-01";

function toCalendarDay(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cmpDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function pickIvaCode(fechaEmision: Date): PickIvaCodeResult {
  const day = toCalendarDay(fechaEmision);
  if (cmpDays(day, IVA_15_EFFECTIVE_FROM) >= 0) {
    return { codigo: IVA_CODIGO, codigoPorcentaje: "4", tarifa: 15 };
  }
  return { codigo: IVA_CODIGO, codigoPorcentaje: "2", tarifa: 12 };
}
```

The selector compares **calendar days** (`YYYY-MM-DD` strings)
lexicographically rather than `Date.getTime()` ms so the host TZ never
shifts the 2024-04-01 boundary. Tests pin:

- 2024-03-31 → 12 % / codigoPorcentaje "2"
- 2024-04-01 → 15 % / codigoPorcentaje "4"
- 2024-04-02 → 15 % / codigoPorcentaje "4"
- 2026-05-19 → 15 % / codigoPorcentaje "4"
- 2017-06-01 / 2023-12-31 → 12 % / codigoPorcentaje "2"

## 5. `computeInvoice` signature + worked example

```ts
export function computeInvoice(input: ComputeInvoiceInput): ComputeInvoiceResult;

interface ComputeInvoiceInput {
  readonly fechaEmision: Date;
  readonly lines: ReadonlyArray<ComputeLineInput>;
  readonly payments: ReadonlyArray<ComputePaymentInput>;
  readonly totalDescuento?: string | number | Decimal;
  readonly propina?: string | number | Decimal;
}
```

### Worked example — `1 × 100 IVA 15 %`

Input:

```ts
{
  fechaEmision: new Date(Date.UTC(2026, 4, 19)), // 2026-05-19
  lines: [{
    orden: 1,
    cantidad: 1,
    precioUnitario: 100,
    descuento: 0,
    impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
  }],
  payments: [{ formaPago: "01", total: 115 }],
}
```

Output:

```ts
{
  lineComputations: [{
    orden: 1,
    precioTotalSinImpuesto: 100,
    impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 }],
  }],
  totalSinImpuestos: 100,
  totalDescuento: 0,
  propina: 0,
  totalImpuestos: [{
    codigo: "2", codigoPorcentaje: "4", tarifa: 15,
    baseImponible: 100, valor: 15,
  }],
  importeTotal: 115,
  paymentsBalanced: true,
  paymentsDelta: 0,
}
```

The same example is covered by an explicit assertion in
`compute.test.ts > computeInvoice — happy path (1 × 100 IVA 15%)`.

## 6. Property invariants asserted (each ≥ 100 runs)

All property tests use deterministic fast-check `Arbitrary`s with
2-decimal money in `[0.01, 9999.99]`, 6-decimal cantidades in
`[0.000001, 100]`, and `(year ∈ [2017,2030], month ∈ [1,12], day ∈ [1,28])`
dates so we cover both sides of the IVA-15 boundary without hitting
month-end edge cases.

| Invariant                                                                                     | Where                                               | numRuns |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------- |
| Determinism: `compute(x) === compute(x)`                                                      | `computeInvoice — determinism`                      | 100     |
| `Σ line.precioTotalSinImpuesto ≈ totalSinImpuestos` (2 dp)                                    | `Σ line.precioTotalSinImpuesto = totalSinImpuestos` | 200     |
| `importeTotal = totalSinImpuestos − totalDescuento + Σ totalImpuestos.valor + propina` (2 dp) | `importeTotal reconciliation`                       | 200     |
| `paymentsBalanced=true` when Σ payments matches importeTotal exactly                          | `paymentsBalanced flag — balanced`                  | 100     |
| `paymentsBalanced=false` when delta > 0.01                                                    | `paymentsBalanced flag — imbalanced`                | 100     |
| `pickIvaCode(d) === pickIvaCode(d)`                                                           | `pickIvaCode determinism`                           | 100     |
| `d < 2024-04-01 ⇒ 12 %; d ≥ 2024-04-01 ⇒ 15 %`                                                | `pickIvaCode boundary invariant`                    | 200     |

The IVA-window invariant is the formal statement of SPEC-0032 AC-2 and
the PROMPT-0032 hard rule about Decreto 198.

## 7. Coverage

```
File           | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
---------------|---------|----------|---------|---------|------------------
compute.ts     |   96.07 |    89.47 |     100 |   96.07 | 246-247,250-251
money.ts       |     100 |      100 |     100 |     100 |
tax-rates.ts   |     100 |      100 |     100 |     100 |
validate.ts    |     100 |      100 |     100 |     100 |
```

The four uncovered lines on `compute.ts` are inside two `throw new
Error("Internal compute error: …")` branches whose conditions are
unreachable by construction (we just inserted the key into `buckets`
ourselves). They exist as defence-in-depth against future refactors —
deleting them to chase 100 % would be a regression. The above figure
exceeds the SPEC-0032 §5 acceptance criterion ("≥ 90 % statements on
compute.ts") with margin.

`repository.ts` shows 0 % coverage in this view because it has no unit
tests yet — that file is in PROMPT-0033 scope and will be exercised by
the integration tests in that prompt. The current pass deliberately
leaves it untested except for the typecheck-blocker fix.

## 8. Deviations from spec / plan

- **None of substance.** All test surfaces called out in TASKS-0032 §3
  ("Compute tests") are covered. The "edit on EMITIDO → 422" and
  "cursor pagination" tests called out in PROMPT-0032 §5 are explicitly
  endpoint-level tests; per the carry-over scope they remain in
  PROMPT-0033.
- The typecheck-blocking dead line in `repository.ts` was removed. The
  removed statement was `updateData.customer = undefined` which both
  (a) referenced a Prisma field that does not exist on `Invoice` and
  (b) had no observable effect since the very next line set
  `customerId` instead. This is a strict no-behaviour-change fix.

## 9. Security review (no PII in tests)

- ✅ Every test uses **synthetic identifiers only**: random ULIDs
  (`01KS6PT809AR5XPR6H4ETPKX3Z`, `01KS6PT80ATT3GYPYBR1JWXEV5`) generated
  for this run, never linked to a real person or company.
- ✅ Customer fixtures use the public CONSUMIDOR FINAL placeholder
  (`9999999999999`) which is the SRI's documented synthetic value, not
  a real RUC/cédula.
- ✅ Money values are bounded inside fast-check arbitraries
  (`[0.01, 9999.99]`) to avoid leaking any real-world prices.
- ✅ No emails, no addresses, no real-world `claveAcceso` strings, no
  certificate material in any test.
- ✅ Tests assert only at the public surface of each module — the
  injected `now` parameter is the sole clock dependency, matching
  SPEC-0032 §6 (no `Date.now()` reads).

The money-math contract documented in `money.ts` is preserved by the
tests: every numerical assertion routes through `decimal.js`; the only
JS-number arithmetic in the test files is the harmless `toBe(115)`
assertion against already-rounded API outputs.

## 10. Suggested follow-ups (PROMPT-0033)

- **Endpoints** — POST/PATCH/GET/DELETE/preview-totals/emit
  controllers + thin handlers calling into the existing repository.
- **Integration tests** in `apps/api/test/invoices.test.ts`:
  - Edit on EMITIDO → 422 `code: "locked"` (SPEC-0032 AC-6).
  - Cursor pagination across 25 invoices in 2 batches (TASKS-0032 §4.4).
  - Cross-tenant `customerId` → 404 (no enumeration).
  - Preview-totals does not persist (count `prisma.invoice` rows
    before/after).
- **RBAC matrix wiring** — add `invoice.create` and `invoice.read`
  permission codes to the permission table.
- **Repository tests** — the soft-delete path, the cursor-pagination
  `nextCursor` semantics, and the customer-relation join should get
  dedicated unit tests once the endpoints exercise them.
- **Audit events** — `invoice.created|updated|deleted` rows are
  defined in TASKS-0032 §6 but not yet emitted (handler layer).

## 11. Sign-off checklist

| Item                                                                    | Status                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AC-1: `computeInvoice` is pure and produces correct totals for fixtures | ✅ — covered by 22 fixture tests in `compute.test.ts` plus 7 property tests                   |
| AC-2: IVA rate switching at 2024-04-01 verified                         | ✅ — boundary test pair in `tax-rates.test.ts`; property invariant runs 200 random dates      |
| AC-3: All money math via decimal.js; no `Number` arithmetic             | ✅ — `money.ts` is 100 %-covered; tests assert string round-tripping for 0.1+0.2              |
| AC-4: Edits forbidden after EMITIDO                                     | ⏳ — deferred to PROMPT-0033 (endpoint test)                                                  |
| AC-5: Cursor pagination stable                                          | ⏳ — deferred to PROMPT-0033 (endpoint test)                                                  |
| AC-6: Property test passes for random inputs                            | ✅ — 7 properties × 100..200 runs each, all green                                             |
| AC-7: Payment sum guard exposed and enforced                            | ✅ — `assertPaymentsMatchTotal` covered; `paymentsBalanced` flag tested at the ±0.01 boundary |
| Coverage `compute.ts` ≥ 90 % statements                                 | ✅ — 96.07 %                                                                                  |
| Tests use synthetic data only (no PII)                                  | ✅                                                                                            |
| `pnpm -r typecheck` exits 0                                             | ✅                                                                                            |
| `pnpm -r build` exits 0                                                 | ✅                                                                                            |
| `pnpm --filter @facturador/api test` exits 0                            | ✅ — 295/295 green                                                                            |
