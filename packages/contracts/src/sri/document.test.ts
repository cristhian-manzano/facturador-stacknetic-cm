/**
 * Tests for `SriEstadoSchema` and `SriDocumentSchema`.
 */
import { describe, expect, it } from "vitest";
import { SriDocumentSchema, SriEstadoSchema } from "./document.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const CLAVE = "1905202601179001234400110010010000001231234567812";

describe("SriEstadoSchema", () => {
  it.each([
    ["PENDIENTE"],
    ["FIRMADO"],
    ["ENVIADO"],
    ["RECIBIDA"],
    ["EN_PROCESO"],
    ["AUTORIZADO"],
    ["NO_AUTORIZADO"],
    ["DEVUELTA"],
    ["ERROR_RED"],
    ["ERROR_BUILD"],
  ])("accepts %s", (value) => {
    expect(SriEstadoSchema.parse(value)).toBe(value);
  });

  it("rejects unknown estado", () => {
    expect(SriEstadoSchema.safeParse("BORRADOR").success).toBe(false);
  });
});

describe("SriDocumentSchema", () => {
  const base = {
    id: ULID,
    companyId: ULID,
    claveAcceso: CLAVE,
    ambiente: "1" as const,
    codDoc: "01" as const,
    estab: "001",
    ptoEmi: "001",
    secuencial: "000000123",
    fechaEmision: "2026-05-19",
    estado: "PENDIENTE" as const,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
  };

  it("accepts a pending document", () => {
    expect(() => SriDocumentSchema.parse(base)).not.toThrow();
  });

  it("accepts an authorised document with numeroAutorizacion", () => {
    expect(() =>
      SriDocumentSchema.parse({
        ...base,
        estado: "AUTORIZADO",
        numeroAutorizacion: CLAVE,
        fechaAutorizacion: "2026-05-19T10:00:00.000+00:00",
      }),
    ).not.toThrow();
  });

  it("rejects with invalid claveAcceso", () => {
    expect(SriDocumentSchema.safeParse({ ...base, claveAcceso: "123" }).success).toBe(false);
  });
});
