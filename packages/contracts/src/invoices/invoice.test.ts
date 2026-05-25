/**
 * Tests for `InvoiceSchema` and its building blocks.
 */
import { describe, expect, it } from "vitest";
import {
  InvoiceEstadoSchema,
  InvoiceImpuestoSchema,
  InvoiceLineSchema,
  InvoicePaymentSchema,
  InvoiceSchema,
} from "./invoice.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const CLAVE_ACCESO = "1905202601179001234400110010010000001231234567812";

const sampleLine = {
  orden: 0,
  descripcion: "Servicio profesional",
  cantidad: 1,
  precioUnitario: 100,
  descuento: 0,
  precioTotalSinImpuesto: 100,
  impuestos: [
    {
      codigo: "2" as const,
      codigoPorcentaje: "4",
      tarifa: 15,
      baseImponible: 100,
      valor: 15,
    },
  ],
};

const sampleInvoice = {
  id: ULID,
  companyId: ULID,
  customerId: ULID,
  emissionPointId: ULID,
  estado: "BORRADOR" as const,
  codDoc: "01" as const,
  estab: "001",
  ptoEmi: "001",
  secuencial: null,
  claveAcceso: null,
  fechaEmision: "2026-05-19",
  moneda: "DOLAR" as const,
  obligadoContabilidad: true,
  contribuyenteEspecial: null,
  totalSinImpuestos: 100,
  totalDescuento: 0,
  totalConImpuestos: [
    {
      codigo: "2" as const,
      codigoPorcentaje: "4",
      tarifa: 15,
      baseImponible: 100,
      valor: 15,
    },
  ],
  propina: 0,
  importeTotal: 115,
  lines: [sampleLine],
  payments: [{ formaPago: "20" as const, total: 115 }],
  adicionales: [],
  createdAt: "2026-05-19T10:00:00.000Z",
  updatedAt: "2026-05-19T10:00:00.000Z",
};

describe("InvoiceEstadoSchema", () => {
  it.each([["BORRADOR"], ["EMITIDO"], ["ANULADO"]])("accepts %s", (value) => {
    expect(InvoiceEstadoSchema.parse(value)).toBe(value);
  });

  it("rejects unknown estado", () => {
    expect(InvoiceEstadoSchema.safeParse("CANCELADO").success).toBe(false);
  });
});

describe("InvoiceLineSchema", () => {
  it("accepts a basic line", () => {
    expect(() => InvoiceLineSchema.parse(sampleLine)).not.toThrow();
  });

  it("rejects negative precioUnitario", () => {
    expect(InvoiceLineSchema.safeParse({ ...sampleLine, precioUnitario: -1 }).success).toBe(false);
  });

  it("rejects empty descripcion", () => {
    expect(InvoiceLineSchema.safeParse({ ...sampleLine, descripcion: "" }).success).toBe(false);
  });

  it("rejects when impuestos is empty", () => {
    expect(InvoiceLineSchema.safeParse({ ...sampleLine, impuestos: [] }).success).toBe(false);
  });
});

describe("InvoiceImpuestoSchema", () => {
  it("rejects unknown codigo", () => {
    expect(
      InvoiceImpuestoSchema.safeParse({
        codigo: "9",
        codigoPorcentaje: "4",
        tarifa: 15,
        baseImponible: 100,
        valor: 15,
      }).success,
    ).toBe(false);
  });
});

describe("InvoicePaymentSchema", () => {
  it("accepts forma pago 20", () => {
    expect(() => InvoicePaymentSchema.parse({ formaPago: "20", total: 115 })).not.toThrow();
  });

  it("rejects unknown forma pago", () => {
    expect(InvoicePaymentSchema.safeParse({ formaPago: "99", total: 115 }).success).toBe(false);
  });
});

describe("InvoiceSchema", () => {
  it("accepts a draft invoice", () => {
    expect(() => InvoiceSchema.parse(sampleInvoice)).not.toThrow();
  });

  it("accepts an emitted invoice with secuencial and claveAcceso", () => {
    expect(() =>
      InvoiceSchema.parse({
        ...sampleInvoice,
        estado: "EMITIDO",
        secuencial: "000000123",
        claveAcceso: CLAVE_ACCESO,
      }),
    ).not.toThrow();
  });

  it("rejects an invoice with empty lines", () => {
    expect(InvoiceSchema.safeParse({ ...sampleInvoice, lines: [] }).success).toBe(false);
  });

  it("rejects an invoice with empty payments", () => {
    expect(InvoiceSchema.safeParse({ ...sampleInvoice, payments: [] }).success).toBe(false);
  });

  it("rejects an invoice with more than 15 adicionales", () => {
    const adicionales = Array.from({ length: 16 }, (_, i) => ({
      nombre: `n${String(i)}`,
      valor: "v",
    }));
    expect(InvoiceSchema.safeParse({ ...sampleInvoice, adicionales }).success).toBe(false);
  });
});
