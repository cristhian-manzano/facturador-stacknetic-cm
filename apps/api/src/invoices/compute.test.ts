/**
 * Tests for `compute.ts` — fixed inputs and expected totals.
 *
 * Test surface (per SPEC-0032 §FR-3..FR-5 + TASKS-0032 §3):
 *   - Happy path: `1 × 100 IVA 15% → subtotal 100 / IVA 15 / total 115`.
 *   - Discounts: line-level `descuento` reduces the base before IVA.
 *   - Multi-line aggregation: bucket per `(codigo, codigoPorcentaje)`.
 *   - Mixed IVA rates: 15% + 0% + 5% within the same invoice.
 *   - `paymentsBalanced` flag flips at the ±0.01 boundary.
 *   - `assertPaymentsMatchTotal` throws on mismatch and stays silent on match.
 *   - Header fields (`totalDescuento`, `propina`) flow through unchanged.
 *
 * Property-based / random invariants are in `compute.property.test.ts` —
 * this file pins the determined outputs the SRI ficha-técnica examples expect.
 *
 * Synthetic-only inputs; no PII.
 */
import { describe, expect, it } from "vitest";

import {
  assertPaymentsMatchTotal,
  computeInvoice,
  type ComputeInvoiceInput,
} from "./compute.js";

/** Local-midnight UTC, matches `parseFechaEmision` shape. */
function utcDay(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const IVA_15 = { codigo: "2", codigoPorcentaje: "4", tarifa: 15 } as const;
const IVA_0 = { codigo: "2", codigoPorcentaje: "0", tarifa: 0 } as const;
const IVA_5 = { codigo: "2", codigoPorcentaje: "5", tarifa: 5 } as const;

describe("computeInvoice — happy path (1 × 100 IVA 15%)", () => {
  const input: ComputeInvoiceInput = {
    fechaEmision: utcDay(2026, 5, 19),
    lines: [
      {
        orden: 1,
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        impuestos: [IVA_15],
      },
    ],
    payments: [{ formaPago: "01", total: 115 }],
  };

  it("computes totalSinImpuestos = 100.00 and importeTotal = 115.00", () => {
    const r = computeInvoice(input);
    expect(r.totalSinImpuestos).toBe(100);
    expect(r.importeTotal).toBe(115);
    expect(r.totalDescuento).toBe(0);
    expect(r.propina).toBe(0);
  });

  it("produces exactly one tax bucket with valor 15.00", () => {
    const r = computeInvoice(input);
    expect(r.totalImpuestos).toHaveLength(1);
    expect(r.totalImpuestos[0]).toMatchObject({
      codigo: "2",
      codigoPorcentaje: "4",
      tarifa: 15,
      baseImponible: 100,
      valor: 15,
    });
  });

  it("returns the per-line breakdown with stable orden", () => {
    const r = computeInvoice(input);
    expect(r.lineComputations).toHaveLength(1);
    expect(r.lineComputations[0]?.orden).toBe(1);
    expect(r.lineComputations[0]?.precioTotalSinImpuesto).toBe(100);
    expect(r.lineComputations[0]?.impuestos[0]?.valor).toBe(15);
  });

  it("flags paymentsBalanced=true when Σ payments = importeTotal", () => {
    const r = computeInvoice(input);
    expect(r.paymentsBalanced).toBe(true);
    expect(r.paymentsDelta).toBe(0);
  });
});

describe("computeInvoice — descuento on a single line", () => {
  it("reduces the base BEFORE applying the IVA percentage", () => {
    // 2 × 50 = 100; minus 10 descuento = 90; IVA 15% of 90 = 13.50; total = 103.50.
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        {
          orden: 1,
          cantidad: 2,
          precioUnitario: 50,
          descuento: 10,
          impuestos: [IVA_15],
        },
      ],
      payments: [{ formaPago: "01", total: 103.5 }],
    });
    expect(r.totalSinImpuestos).toBe(90);
    expect(r.totalImpuestos[0]?.valor).toBe(13.5);
    expect(r.importeTotal).toBe(103.5);
    expect(r.paymentsBalanced).toBe(true);
  });

  it("treats undefined descuento as 0 (default)", () => {
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        {
          orden: 1,
          cantidad: 1,
          precioUnitario: 100,
          impuestos: [IVA_15],
        },
      ],
      payments: [{ formaPago: "01", total: 115 }],
    });
    expect(r.totalSinImpuestos).toBe(100);
    expect(r.importeTotal).toBe(115);
  });
});

describe("computeInvoice — multi-line aggregation per (codigo, codigoPorcentaje)", () => {
  it("aggregates two IVA-15% lines into one bucket", () => {
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 1, cantidad: 1, precioUnitario: 100, impuestos: [IVA_15] },
        { orden: 2, cantidad: 2, precioUnitario: 50, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 230 }],
    });
    expect(r.totalSinImpuestos).toBe(200);
    expect(r.totalImpuestos).toHaveLength(1);
    expect(r.totalImpuestos[0]).toMatchObject({
      codigoPorcentaje: "4",
      baseImponible: 200,
      valor: 30,
    });
    expect(r.importeTotal).toBe(230);
  });

  it("preserves line orden when echoing back", () => {
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 7, cantidad: 1, precioUnitario: 10, impuestos: [IVA_15] },
        { orden: 3, cantidad: 1, precioUnitario: 20, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 34.5 }],
    });
    // Compute does not reorder — it mirrors the input order.
    expect(r.lineComputations.map((l) => l.orden)).toEqual([7, 3]);
  });
});

describe("computeInvoice — mixed IVA rates (15% + 0% + 5%)", () => {
  const input: ComputeInvoiceInput = {
    fechaEmision: utcDay(2026, 5, 19),
    lines: [
      // 100 @ 15% → IVA 15
      { orden: 1, cantidad: 1, precioUnitario: 100, impuestos: [IVA_15] },
      // 50 @ 0%  → IVA 0
      { orden: 2, cantidad: 1, precioUnitario: 50, impuestos: [IVA_0] },
      // 200 @ 5% (construcción) → IVA 10
      { orden: 3, cantidad: 1, precioUnitario: 200, impuestos: [IVA_5] },
    ],
    // 100 + 50 + 200 = 350 subtotal. IVA = 15 + 0 + 10 = 25. Total = 375.
    payments: [{ formaPago: "01", total: 375 }],
  };

  it("produces one bucket per (codigo, codigoPorcentaje)", () => {
    const r = computeInvoice(input);
    expect(r.totalImpuestos).toHaveLength(3);
    const cps = r.totalImpuestos.map((b) => b.codigoPorcentaje).sort();
    expect(cps).toEqual(["0", "4", "5"]);
  });

  it("sums each bucket independently", () => {
    const r = computeInvoice(input);
    const byCp = Object.fromEntries(
      r.totalImpuestos.map((b) => [b.codigoPorcentaje, b]),
    );
    expect(byCp["4"]).toMatchObject({ baseImponible: 100, valor: 15 });
    expect(byCp["0"]).toMatchObject({ baseImponible: 50, valor: 0 });
    expect(byCp["5"]).toMatchObject({ baseImponible: 200, valor: 10 });
  });

  it("totals reconcile: 350 subtotal, 25 IVA, 375 importeTotal", () => {
    const r = computeInvoice(input);
    expect(r.totalSinImpuestos).toBe(350);
    expect(r.importeTotal).toBe(375);
    expect(r.paymentsBalanced).toBe(true);
  });
});

describe("computeInvoice — header propina and totalDescuento", () => {
  it("adds propina to importeTotal after IVA", () => {
    // 1 × 100 @ 15% IVA = 115; +10 propina = 125.
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 1, cantidad: 1, precioUnitario: 100, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 125 }],
      propina: 10,
    });
    expect(r.propina).toBe(10);
    expect(r.importeTotal).toBe(125);
    expect(r.paymentsBalanced).toBe(true);
  });

  it("subtracts header totalDescuento BEFORE adding IVA buckets", () => {
    // 1 × 100 line → base 100; IVA 15% on the line → 15. Header descuento 5
    // applies to the importeTotal arithmetic: 100 - 5 + 15 = 110.
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 1, cantidad: 1, precioUnitario: 100, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 110 }],
      totalDescuento: 5,
    });
    expect(r.totalDescuento).toBe(5);
    expect(r.totalSinImpuestos).toBe(100);
    expect(r.importeTotal).toBe(110);
    expect(r.paymentsBalanced).toBe(true);
  });
});

describe("computeInvoice — paymentsBalanced flag", () => {
  const baseInput: ComputeInvoiceInput = {
    fechaEmision: utcDay(2026, 5, 19),
    lines: [
      { orden: 1, cantidad: 1, precioUnitario: 100, impuestos: [IVA_15] },
    ],
    payments: [],
  };

  it("is true when Σ payments = importeTotal exactly", () => {
    const r = computeInvoice({
      ...baseInput,
      payments: [{ formaPago: "01", total: 115 }],
    });
    expect(r.paymentsBalanced).toBe(true);
    expect(r.paymentsDelta).toBe(0);
  });

  it("is true at the ±0.01 tolerance edge", () => {
    const r = computeInvoice({
      ...baseInput,
      payments: [{ formaPago: "01", total: 115.01 }],
    });
    expect(r.paymentsBalanced).toBe(true);
    expect(r.paymentsDelta).toBe(0.01);
  });

  it("is false when delta exceeds 0.01 (e.g. 0.02 short)", () => {
    const r = computeInvoice({
      ...baseInput,
      payments: [{ formaPago: "01", total: 114.98 }],
    });
    expect(r.paymentsBalanced).toBe(false);
    expect(r.paymentsDelta).toBe(0.02);
  });

  it("is false when payments are absent (Σ = 0 ≠ 115)", () => {
    const r = computeInvoice(baseInput);
    expect(r.paymentsBalanced).toBe(false);
    expect(r.paymentsDelta).toBe(115);
  });

  it("sums multiple payments before comparing", () => {
    const r = computeInvoice({
      ...baseInput,
      payments: [
        { formaPago: "01", total: 50 },
        { formaPago: "20", total: 65 },
      ],
    });
    expect(r.paymentsBalanced).toBe(true);
  });
});

describe("computeInvoice — accepts string and Decimal inputs", () => {
  it("treats string inputs identically to numbers (no float drift)", () => {
    const r = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        {
          orden: 1,
          cantidad: "1",
          precioUnitario: "100.00",
          descuento: "0",
          impuestos: [IVA_15],
        },
      ],
      payments: [{ formaPago: "01", total: "115" }],
    });
    expect(r.totalSinImpuestos).toBe(100);
    expect(r.importeTotal).toBe(115);
    expect(r.paymentsBalanced).toBe(true);
  });
});

describe("computeInvoice — HALF_UP rounding at the line level", () => {
  it("rounds 0.005 IVA up (1 × 0.03 × 15% = 0.0045 → 0.00; 1 × 0.04 × 15% = 0.006 → 0.01)", () => {
    // 0.03 * 0.15 = 0.0045 → HALF_UP at 2 dp = 0.00.
    const r1 = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 1, cantidad: 1, precioUnitario: 0.03, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 0.03 }],
    });
    expect(r1.totalImpuestos[0]?.valor).toBe(0);

    // 0.04 * 0.15 = 0.006 → HALF_UP at 2 dp = 0.01.
    const r2 = computeInvoice({
      fechaEmision: utcDay(2026, 5, 19),
      lines: [
        { orden: 1, cantidad: 1, precioUnitario: 0.04, impuestos: [IVA_15] },
      ],
      payments: [{ formaPago: "01", total: 0.05 }],
    });
    expect(r2.totalImpuestos[0]?.valor).toBe(0.01);
  });
});

describe("assertPaymentsMatchTotal", () => {
  it("returns void when paymentsBalanced=true", () => {
    expect(() =>
      { assertPaymentsMatchTotal({
        paymentsBalanced: true,
        paymentsDelta: 0,
        importeTotal: 100,
      }); },
    ).not.toThrow();
  });

  it("throws when paymentsBalanced=false (delta visible in message)", () => {
    let captured: unknown;
    try {
      assertPaymentsMatchTotal({
        paymentsBalanced: false,
        paymentsDelta: 0.02,
        importeTotal: 100,
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain("0.02");
    expect((captured as Error).message).toContain("100");
  });
});
