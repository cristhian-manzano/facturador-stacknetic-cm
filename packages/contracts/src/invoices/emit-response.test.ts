/**
 * Tests for `EmitInvoiceResponseSchema`.
 */
import { describe, expect, it } from "vitest";
import { EmitInvoiceResponseSchema } from "./emit-response.js";

const CLAVE = "1905202601179001234400110010010000001231234567812";

describe("EmitInvoiceResponseSchema", () => {
  it("accepts an AUTORIZADO emission with authorization number", () => {
    expect(() =>
      EmitInvoiceResponseSchema.parse({
        estado: "AUTORIZADO",
        claveAcceso: CLAVE,
        numeroAutorizacion: CLAVE,
        fechaAutorizacion: "2026-05-19T10:00:00.000+00:00",
      }),
    ).not.toThrow();
  });

  it("accepts a DEVUELTA emission with mensajes", () => {
    expect(() =>
      EmitInvoiceResponseSchema.parse({
        estado: "DEVUELTA",
        claveAcceso: CLAVE,
        mensajes: [
          {
            identificador: "35",
            mensaje: "Falta cantidad",
            tipo: "ERROR",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown estado", () => {
    expect(
      EmitInvoiceResponseSchema.safeParse({
        estado: "AUTORIZADO_PENDIENTE",
        claveAcceso: CLAVE,
      }).success,
    ).toBe(false);
  });
});
