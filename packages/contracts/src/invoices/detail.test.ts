/**
 * Tests for `InvoiceDetailSchema`.
 */
import { describe, expect, it } from "vitest";

import { InvoiceDetailSchema } from "./detail.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const CLAVE = "1905202601179001234400110010010000001231234567812";

const lineImpuesto = {
  codigo: "2" as const,
  codigoPorcentaje: "4",
  tarifa: 15,
  baseImponible: 100,
  valor: 15,
};

const detailFixture = {
  invoice: {
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
    totalConImpuestos: [lineImpuesto],
    propina: 0,
    importeTotal: 115,
    lines: [
      {
        orden: 0,
        descripcion: "Servicio",
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        precioTotalSinImpuesto: 100,
        impuestos: [lineImpuesto],
      },
    ],
    payments: [{ formaPago: "20" as const, total: 115 }],
    adicionales: [],
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
  },
  customer: {
    id: ULID,
    companyId: ULID,
    isActive: true,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    deletedAt: null,
    tipoIdentificacion: "07" as const,
    identificacion: "9999999999999" as const,
    razonSocial: "CONSUMIDOR FINAL" as const,
  },
  sriDocument: null,
  sriEvents: [],
};

describe("InvoiceDetailSchema", () => {
  it("accepts a draft detail", () => {
    expect(() => InvoiceDetailSchema.parse(detailFixture)).not.toThrow();
  });

  it("accepts a detail with sriDocument and one BUILD event", () => {
    expect(() =>
      InvoiceDetailSchema.parse({
        ...detailFixture,
        sriDocument: {
          id: ULID,
          companyId: ULID,
          claveAcceso: CLAVE,
          ambiente: "1",
          codDoc: "01",
          estab: "001",
          ptoEmi: "001",
          secuencial: "000000123",
          fechaEmision: "2026-05-19",
          estado: "AUTORIZADO",
          numeroAutorizacion: CLAVE,
          fechaAutorizacion: "2026-05-19T10:00:00.000+00:00",
          createdAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
        },
        sriEvents: [
          {
            id: ULID,
            documentId: ULID,
            etapa: "BUILD",
            estado: "PENDIENTE",
            mensajes: [],
            durationMs: 12,
            createdAt: "2026-05-19T10:00:00.000Z",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects when customer is missing", () => {
    const { customer: _omitted, ...rest } = detailFixture;
    expect(InvoiceDetailSchema.safeParse(rest).success).toBe(false);
  });
});
