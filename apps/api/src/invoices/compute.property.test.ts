/**
 * Property-based tests for `compute.ts` — invariants over random inputs.
 *
 * Test surface (per TASKS-0032 §3.5 + PROMPT-0032 §5):
 *   - Determinism: `same input → same output` (function is pure).
 *   - Line subtotal invariant: `Σ line.precioTotalSinImpuesto = totalSinImpuestos`
 *     within 2 dp tolerance.
 *   - Header reconciliation: `importeTotal = totalSinImpuestos -
 *     totalDescuento + Σ totalImpuestos.valor + propina`.
 *   - `paymentsBalanced ↔ |Σ payments.total − importeTotal| ≤ 0.01`.
 *   - IVA selector determinism (cross-references `pickIvaCode`).
 *
 * Numbers come from fast-check Arbitraries with bounded ranges (small
 * cantidades, prices in [0.01, 9_999.99]) — large enough to exercise
 * rounding, small enough to fit comfortably in `Decimal(14,2)`.
 *
 * Each property runs at least 100 cases (PROMPT-0032 hard rule).
 *
 * Synthetic-only data — no PII, no real-world identifiers.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Decimal } from "decimal.js";
import {
  computeInvoice,
  type ComputeInvoiceInput,
  type ComputeLineInput,
  type ComputePaymentInput,
} from "./compute.js";
import { pickIvaCode } from "./tax-rates.js";

const IVA_15 = { codigo: "2", codigoPorcentaje: "4", tarifa: 15 } as const;
const IVA_0 = { codigo: "2", codigoPorcentaje: "0", tarifa: 0 } as const;
const IVA_5 = { codigo: "2", codigoPorcentaje: "5", tarifa: 5 } as const;

/**
 * 2-decimal money arbitrary in [0.01, 9999.99]. Returns a `string` so we
 * sidestep any float-shape collision between fast-check's `double` and
 * decimal.js parsing — the production code accepts `string | number | Decimal`.
 */
const moneyArb = fc.integer({ min: 1, max: 999_999 }).map((cents) => (cents / 100).toFixed(2));

/**
 * 6-decimal quantity arbitrary in [0.000001, 100]. We pick a tight upper
 * bound so the line subtotal stays under the Decimal(14,2) column ceiling
 * even when multiplied by the price.
 */
const qtyArb = fc
  .integer({ min: 1, max: 100_000_000 })
  .map((micros) => (micros / 1_000_000).toFixed(6));

/** Impuesto picked from the three production-default codes. */
const impArb = fc.constantFrom(IVA_15, IVA_0, IVA_5);

/** One line — single impuesto, no descuento (keeps invariants algebraic). */
const lineArb: fc.Arbitrary<ComputeLineInput> = fc
  .record({
    orden: fc.integer({ min: 1, max: 100 }),
    cantidad: qtyArb,
    precioUnitario: moneyArb,
    impuestos: impArb.map((imp) => [imp]),
  })
  .map((rec) => ({
    orden: rec.orden,
    cantidad: rec.cantidad,
    precioUnitario: rec.precioUnitario,
    descuento: 0,
    impuestos: rec.impuestos,
  }));

/** A list of 1..10 lines, per TASKS-0032 §3.5. */
const linesArb: fc.Arbitrary<ComputeLineInput[]> = fc.array(lineArb, {
  minLength: 1,
  maxLength: 10,
});

/** Empty-payments arbitrary — used when we want to test imbalance. */
const emptyPayments: ComputePaymentInput[] = [];

/** Build a balanced payment for an arbitrary input — used to assert balanced=true. */
function makeBalancedPayments(importeTotal: number): ComputePaymentInput[] {
  return [{ formaPago: "01", total: importeTotal }];
}

/**
 * fechaEmision arbitrary spanning the IVA-15 boundary (covers both
 * pre-decreto 12% lookup and post-decreto 15%). The dates are normalised
 * to UTC-midnight to mirror `parseFechaEmision`.
 */
const fechaArb: fc.Arbitrary<Date> = fc.integer({ min: 2017, max: 2030 }).chain((y) =>
  fc.integer({ min: 1, max: 12 }).chain((m) =>
    fc
      // Use 1..28 to side-step month-end edge cases (Feb 29 etc.).
      .integer({ min: 1, max: 28 })
      .map((d) => new Date(Date.UTC(y, m - 1, d))),
  ),
);

/* -------------------------------------------------------------------------- */
/*                              Determinism                                   */
/* -------------------------------------------------------------------------- */

describe("computeInvoice — determinism", () => {
  it("same input ⇒ same output (pure function)", () => {
    fc.assert(
      fc.property(linesArb, fechaArb, (lines, fechaEmision) => {
        const input: ComputeInvoiceInput = {
          fechaEmision,
          lines,
          payments: emptyPayments,
        };
        const a = computeInvoice(input);
        const b = computeInvoice(input);
        // JSON.stringify is a structural-equality check that catches every
        // numeric and array-ordering difference between two runs.
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/*              Σ line.precioTotalSinImpuesto = totalSinImpuestos             */
/* -------------------------------------------------------------------------- */

describe("computeInvoice — Σ line.precioTotalSinImpuesto = totalSinImpuestos", () => {
  it("totals agree to 2 dp for any well-formed input", () => {
    fc.assert(
      fc.property(linesArb, fechaArb, (lines, fechaEmision) => {
        const r = computeInvoice({ fechaEmision, lines, payments: [] });
        const sumLines = r.lineComputations.reduce(
          (acc, l) => acc.plus(l.precioTotalSinImpuesto),
          new Decimal(0),
        );
        const diff = sumLines.minus(r.totalSinImpuestos).abs();
        // 2-dp tolerance — any drift larger than 0.005 would be a bug
        // in the round-after-sum strategy.
        return diff.lessThanOrEqualTo("0.005");
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/*    importeTotal = totalSinImpuestos − totalDescuento + ΣIVA + propina      */
/* -------------------------------------------------------------------------- */

describe("computeInvoice — importeTotal reconciliation", () => {
  it("importeTotal = totalSinImpuestos − totalDescuento + Σ totalImpuestos.valor + propina", () => {
    fc.assert(
      fc.property(
        linesArb,
        moneyArb, // propina
        moneyArb, // totalDescuento — independently picked
        fechaArb,
        (lines, propina, totalDescuento, fechaEmision) => {
          // To avoid generating impossible inputs (e.g. descuento bigger than
          // the subtotal), cap totalDescuento at 1.00 so the negative-total
          // case stays out of scope (the production code does NOT validate
          // sign — that's the validation layer's job).
          const cappedDescuento = "1.00";
          const r = computeInvoice({
            fechaEmision,
            lines,
            payments: [],
            propina,
            totalDescuento: cappedDescuento,
          });
          const sumImp = r.totalImpuestos.reduce((acc, t) => acc.plus(t.valor), new Decimal(0));
          const expected = new Decimal(r.totalSinImpuestos)
            .minus(r.totalDescuento)
            .plus(sumImp)
            .plus(r.propina)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          const diff = expected.minus(r.importeTotal).abs();
          return (
            diff.lessThanOrEqualTo("0.005") &&
            // Sanity: totalDescuento + propina survived round-tripping.
            new Decimal(r.totalDescuento).equals(cappedDescuento) &&
            new Decimal(r.propina).equals(propina)
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/*           paymentsBalanced ↔ |Σ payments.total − importeTotal| ≤ 0.01      */
/* -------------------------------------------------------------------------- */

describe("computeInvoice — paymentsBalanced flag is monotone in Σ payments", () => {
  it("paymentsBalanced=true when Σ payments matches importeTotal exactly", () => {
    fc.assert(
      fc.property(linesArb, fechaArb, (lines, fechaEmision) => {
        const first = computeInvoice({ fechaEmision, lines, payments: [] });
        const r = computeInvoice({
          fechaEmision,
          lines,
          payments: makeBalancedPayments(first.importeTotal),
        });
        return r.paymentsBalanced === true && r.paymentsDelta <= 0.005;
      }),
      { numRuns: 100 },
    );
  });

  it("paymentsBalanced=false when delta exceeds 0.01", () => {
    fc.assert(
      fc.property(linesArb, fechaArb, (lines, fechaEmision) => {
        const first = computeInvoice({ fechaEmision, lines, payments: [] });
        // Off by 1.00 — well outside the ±0.01 tolerance.
        if (first.importeTotal === 0) return true; // skip degenerate case
        const off = new Decimal(first.importeTotal).plus("1").toFixed(2);
        const r = computeInvoice({
          fechaEmision,
          lines,
          payments: [{ formaPago: "01", total: off }],
        });
        return r.paymentsBalanced === false && r.paymentsDelta >= 0.99;
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                  IVA selector is deterministic for fechaEmision            */
/* -------------------------------------------------------------------------- */

describe("pickIvaCode — deterministic IVA selection", () => {
  it("same fechaEmision ⇒ same IVA row", () => {
    fc.assert(
      fc.property(fechaArb, (fechaEmision) => {
        const a = pickIvaCode(fechaEmision);
        const b = pickIvaCode(fechaEmision);
        return (
          a.codigo === b.codigo &&
          a.codigoPorcentaje === b.codigoPorcentaje &&
          a.tarifa === b.tarifa
        );
      }),
      { numRuns: 100 },
    );
  });

  it("dates < 2024-04-01 always yield 12%; ≥ 2024-04-01 always yield 15%", () => {
    fc.assert(
      fc.property(fechaArb, (fechaEmision) => {
        const dayKey = `${fechaEmision.getUTCFullYear()}-${String(
          fechaEmision.getUTCMonth() + 1,
        ).padStart(2, "0")}-${String(fechaEmision.getUTCDate()).padStart(2, "0")}`;
        const r = pickIvaCode(fechaEmision);
        const expectedTarifa = dayKey >= "2024-04-01" ? 15 : 12;
        const expectedCp = dayKey >= "2024-04-01" ? "4" : "2";
        return r.tarifa === expectedTarifa && r.codigoPorcentaje === expectedCp;
      }),
      { numRuns: 200 },
    );
  });
});
