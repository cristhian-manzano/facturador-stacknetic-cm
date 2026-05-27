/**
 * Smoke tests for the FacturaXmlInputSchema (SPEC-0023 §6.2). We assert
 * that:
 *
 *   - A minimal, valid factura payload round-trips.
 *   - Optional fields stay optional (omitting them passes).
 *   - Empty arrays for `detalles` / `pagos` / `totalConImpuestos` fail.
 *   - `tarifa` rejects negative values.
 *   - `tipoEmision` and `codDoc` are literal-pinned.
 */
import { describe, it, expect } from "vitest";

import { FacturaXmlInputSchema } from "./factura-input.js";

// `baseInput` is typed as `z.input` (pre-parse) so we don't need to mint
// branded primitives by hand — the schema brands them on `parse`.
const baseInput: unknown = {
  infoTributaria: {
    ambiente: "1",
    tipoEmision: "1",
    razonSocial: "FACTURADOR DEMO S.A.",
    ruc: "9990000015001",
    claveAcceso: "1905202601999000001500110010010000000011234567811",
    codDoc: "01",
    estab: "001",
    ptoEmi: "001",
    secuencial: "000000001",
    dirMatriz: "Av. Demo 123",
  },
  infoFactura: {
    fechaEmision: "19/05/2026",
    tipoIdentificacionComprador: "07",
    razonSocialComprador: "CONSUMIDOR FINAL",
    identificacionComprador: "9999999999999",
    totalSinImpuestos: 100,
    totalDescuento: 0,
    totalConImpuestos: [
      {
        codigo: "2",
        codigoPorcentaje: "4",
        baseImponible: 100,
        tarifa: 15,
        valor: 15,
      },
    ],
    importeTotal: 115,
    pagos: [{ formaPago: "20", total: 115 }],
  },
  detalles: [
    {
      descripcion: "Producto demo",
      cantidad: 1,
      precioUnitario: 100,
      descuento: 0,
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
};

describe("FacturaXmlInputSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(FacturaXmlInputSchema.parse(baseInput)).toBeTruthy();
  });

  it("rejects empty detalles", () => {
    const bad = { ...(baseInput as Record<string, unknown>), detalles: [] };
    expect(() => FacturaXmlInputSchema.parse(bad)).toThrow();
  });

  it("rejects empty pagos", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as {
      infoFactura: { pagos: unknown[] };
    };
    cloned.infoFactura.pagos = [];
    expect(() => FacturaXmlInputSchema.parse(cloned)).toThrow();
  });

  it("rejects empty totalConImpuestos", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as {
      infoFactura: { totalConImpuestos: unknown[] };
    };
    cloned.infoFactura.totalConImpuestos = [];
    expect(() => FacturaXmlInputSchema.parse(cloned)).toThrow();
  });

  it("rejects negative tarifa", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as {
      detalles: { impuestos: { tarifa: number }[] }[];
    };
    const det = cloned.detalles[0];
    if (!det) throw new Error("fixture missing detalles[0]");
    const imp = det.impuestos[0];
    if (!imp) throw new Error("fixture missing impuestos[0]");
    imp.tarifa = -1;
    expect(() => FacturaXmlInputSchema.parse(cloned)).toThrow();
  });

  it("rejects unsupported codDoc literal", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as {
      infoTributaria: { codDoc: string };
    };
    cloned.infoTributaria.codDoc = "04";
    expect(() => FacturaXmlInputSchema.parse(cloned)).toThrow();
  });

  it("rejects newline in razonSocial", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as {
      infoTributaria: { razonSocial: string };
    };
    cloned.infoTributaria.razonSocial = "ACME\nINC";
    expect(() => FacturaXmlInputSchema.parse(cloned)).toThrow();
  });

  it("accepts optional infoAdicional", () => {
    const cloned = JSON.parse(JSON.stringify(baseInput)) as Record<string, unknown>;
    cloned.infoAdicional = [{ nombre: "Email", valor: "demo@example.com" }];
    expect(FacturaXmlInputSchema.parse(cloned)).toBeTruthy();
  });
});
