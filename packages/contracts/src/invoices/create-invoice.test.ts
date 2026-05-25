/**
 * Tests for `CreateInvoiceSchema`. Per TASKS-0005 §6.1/§6.2.
 */
import { describe, expect, it } from "vitest";
import { CreateInvoiceSchema } from "./create-invoice.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

const validLine = {
  descripcion: "Servicio profesional",
  cantidad: 1,
  precioUnitario: 100,
  impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
};

describe("CreateInvoiceSchema", () => {
  it("accepts a payload that references a customerId", () => {
    expect(() =>
      CreateInvoiceSchema.parse({
        emissionPointId: ULID,
        customerId: ULID,
        fechaEmision: "2026-05-19",
        lines: [validLine],
        payments: [{ formaPago: "20", total: 115 }],
      }),
    ).not.toThrow();
  });

  it("accepts an inline customer (consumidor final)", () => {
    expect(() =>
      CreateInvoiceSchema.parse({
        emissionPointId: ULID,
        customer: {
          tipoIdentificacion: "07",
          identificacion: "9999999999999",
          razonSocial: "CONSUMIDOR FINAL",
        },
        fechaEmision: "2026-05-19",
        lines: [validLine],
        payments: [{ formaPago: "01", total: 115 }],
      }),
    ).not.toThrow();
  });

  it("rejects when neither customerId nor customer is provided", () => {
    expect(
      CreateInvoiceSchema.safeParse({
        emissionPointId: ULID,
        fechaEmision: "2026-05-19",
        lines: [validLine],
        payments: [{ formaPago: "20", total: 115 }],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty lines array", () => {
    expect(
      CreateInvoiceSchema.safeParse({
        emissionPointId: ULID,
        customerId: ULID,
        fechaEmision: "2026-05-19",
        lines: [],
        payments: [{ formaPago: "20", total: 0 }],
      }).success,
    ).toBe(false);
  });

  it("rejects a line with negative precioUnitario", () => {
    expect(
      CreateInvoiceSchema.safeParse({
        emissionPointId: ULID,
        customerId: ULID,
        fechaEmision: "2026-05-19",
        lines: [{ ...validLine, precioUnitario: -1 }],
        payments: [{ formaPago: "20", total: 0 }],
      }).success,
    ).toBe(false);
  });

  it("rejects more than 500 lines", () => {
    const lines = Array.from({ length: 501 }, () => validLine);
    expect(
      CreateInvoiceSchema.safeParse({
        emissionPointId: ULID,
        customerId: ULID,
        fechaEmision: "2026-05-19",
        lines,
        payments: [{ formaPago: "20", total: 0 }],
      }).success,
    ).toBe(false);
  });
});
