/**
 * Tests for `PreviewTotalsRequest/ResponseSchema`.
 */
import { describe, expect, it } from "vitest";
import { PreviewTotalsRequestSchema, PreviewTotalsResponseSchema } from "./preview-totals.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

describe("PreviewTotalsRequestSchema", () => {
  it("accepts the same shape as CreateInvoice", () => {
    expect(() =>
      PreviewTotalsRequestSchema.parse({
        emissionPointId: ULID,
        customerId: ULID,
        fechaEmision: "2026-05-19",
        lines: [
          {
            descripcion: "Servicio",
            cantidad: 1,
            precioUnitario: 100,
            impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
          },
        ],
        payments: [{ formaPago: "20", total: 115 }],
      }),
    ).not.toThrow();
  });
});

describe("PreviewTotalsResponseSchema", () => {
  it("accepts a computed totals response", () => {
    expect(() =>
      PreviewTotalsResponseSchema.parse({
        lines: [
          {
            precioTotalSinImpuesto: 100,
            impuestos: [
              {
                codigo: "2",
                codigoPorcentaje: "4",
                tarifa: 15,
                baseImponible: 100,
                valor: 15,
              },
            ],
          },
        ],
        totalSinImpuestos: 100,
        totalDescuento: 0,
        totalConImpuestos: [
          {
            codigo: "2",
            codigoPorcentaje: "4",
            tarifa: 15,
            baseImponible: 100,
            valor: 15,
          },
        ],
        propina: 0,
        importeTotal: 115,
      }),
    ).not.toThrow();
  });

  it("rejects a response with negative importeTotal", () => {
    expect(
      PreviewTotalsResponseSchema.safeParse({
        lines: [],
        totalSinImpuestos: 0,
        totalDescuento: 0,
        totalConImpuestos: [],
        propina: 0,
        importeTotal: -1,
      }).success,
    ).toBe(false);
  });
});
