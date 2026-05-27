/**
 * Tests for `UpdateInvoiceSchema`.
 */
import { describe, expect, it } from "vitest";

import { UpdateInvoiceSchema } from "./update-invoice.js";

describe("UpdateInvoiceSchema", () => {
  it("accepts a single-field update (propina only)", () => {
    expect(() => UpdateInvoiceSchema.parse({ propina: 5 })).not.toThrow();
  });

  it("rejects an empty update body", () => {
    expect(UpdateInvoiceSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a line with empty descripcion", () => {
    expect(
      UpdateInvoiceSchema.safeParse({
        lines: [
          {
            descripcion: "",
            cantidad: 1,
            precioUnitario: 1,
            impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
