/**
 * Tests for invoice list shapes.
 */
import { describe, expect, it } from "vitest";
import { InvoiceListItemSchema, InvoiceListResponseSchema } from "./list.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

describe("InvoiceListItemSchema", () => {
  it("accepts a minimal draft row", () => {
    expect(() =>
      InvoiceListItemSchema.parse({
        id: ULID,
        estado: "BORRADOR",
        fechaEmision: "2026-05-19",
        customerRazonSocial: "ACME",
        estab: "001",
        ptoEmi: "001",
        importeTotal: 0,
      }),
    ).not.toThrow();
  });

  it("accepts an emitted row with sriEstado", () => {
    expect(() =>
      InvoiceListItemSchema.parse({
        id: ULID,
        estado: "EMITIDO",
        sriEstado: "AUTORIZADO",
        fechaEmision: "2026-05-19",
        customerRazonSocial: "ACME",
        estab: "001",
        ptoEmi: "001",
        secuencial: "000000123",
        claveAcceso: "1905202601179001234400110010010000001231234567812",
        importeTotal: 115,
      }),
    ).not.toThrow();
  });

  it("rejects unknown estado", () => {
    expect(
      InvoiceListItemSchema.safeParse({
        id: ULID,
        estado: "DELETED",
        fechaEmision: "2026-05-19",
        customerRazonSocial: "ACME",
        estab: "001",
        ptoEmi: "001",
        importeTotal: 0,
      }).success,
    ).toBe(false);
  });
});

describe("InvoiceListResponseSchema", () => {
  it("accepts an empty list with null cursor", () => {
    expect(() => InvoiceListResponseSchema.parse({ items: [], nextCursor: null })).not.toThrow();
  });

  it("rejects when nextCursor is not a ULID or null", () => {
    expect(InvoiceListResponseSchema.safeParse({ items: [], nextCursor: "next" }).success).toBe(
      false,
    );
  });
});
