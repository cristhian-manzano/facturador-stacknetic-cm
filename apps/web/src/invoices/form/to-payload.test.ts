/**
 * `toCreateInvoicePayload` / `toUpdateInvoicePayload` tests
 * (verify the form → CreateInvoice boundary).
 */
import { describe, expect, it } from "vitest";

import { toCreateInvoicePayload, toUpdateInvoicePayload } from "./to-payload.js";
import type { InvoiceFormValues } from "./types.js";

function base(overrides: Partial<InvoiceFormValues> = {}): InvoiceFormValues {
  return {
    emissionPointId: "01KS5R6NXR0MY0X8SFHAH0GYBB",
    customerId: "01KS5R6NXR0MY0X8SFHAH0GYCC",
    fechaEmision: "2026-05-25",
    lines: [
      {
        descripcion: "X",
        cantidad: "1",
        precioUnitario: "100",
        descuento: "0",
        codigoPorcentaje: "4",
        tarifa: 15,
      },
    ],
    payments: [{ formaPago: "01", total: "115" }],
    adicionales: [],
    ...overrides,
  };
}

describe("toCreateInvoicePayload", () => {
  it("builds a valid CreateInvoice from a happy-path form", () => {
    const r = toCreateInvoicePayload(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lines).toHaveLength(1);
      expect(r.value.lines[0]?.cantidad).toBe(1);
      expect(r.value.lines[0]?.precioUnitario).toBe(100);
      expect(r.value.lines[0]?.impuestos[0]?.codigoPorcentaje).toBe("4");
      expect(r.value.payments[0]?.total).toBe(115);
    }
  });

  it("rejects missing emissionPointId", () => {
    const r = toCreateInvoicePayload(base({ emissionPointId: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldPath).toBe("emissionPointId");
  });

  it("rejects missing customerId", () => {
    const r = toCreateInvoicePayload(base({ customerId: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldPath).toBe("customerId");
  });

  it("rejects unparseable cantidad", () => {
    const r = toCreateInvoicePayload(
      base({
        lines: [
          {
            descripcion: "X",
            cantidad: "abc",
            precioUnitario: "100",
            descuento: "0",
            codigoPorcentaje: "4",
            tarifa: 15,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldPath).toBe("lines.0.cantidad");
  });

  it("rejects unknown IVA code", () => {
    const r = toCreateInvoicePayload(
      base({
        lines: [
          {
            descripcion: "X",
            cantidad: "1",
            precioUnitario: "100",
            descuento: "0",
            codigoPorcentaje: "99",
            tarifa: 0,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("includes adicionales when non-empty", () => {
    const r = toCreateInvoicePayload(
      base({
        adicionales: [
          { nombre: "Obs", valor: "ok" },
          { nombre: "", valor: "" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.adicionales).toEqual([{ nombre: "Obs", valor: "ok" }]);
  });

  it("rejects bad descuento", () => {
    const r = toCreateInvoicePayload(
      base({
        lines: [
          {
            descripcion: "X",
            cantidad: "1",
            precioUnitario: "100",
            descuento: "bad",
            codigoPorcentaje: "4",
            tarifa: 15,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects bad payment total", () => {
    const r = toCreateInvoicePayload(
      base({
        payments: [{ formaPago: "01", total: "nope" }],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("toUpdateInvoicePayload", () => {
  it("returns the patch body without emissionPointId", () => {
    const r = toUpdateInvoicePayload(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("emissionPointId" in r.value).toBe(false);
      expect(r.value.customerId).toBe(base().customerId);
    }
  });

  it("propagates parse failures", () => {
    const r = toUpdateInvoicePayload(base({ emissionPointId: "" }));
    expect(r.ok).toBe(false);
  });
});
