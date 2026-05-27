/**
 * Tests for `EmitDocumentRequestSchema`.
 */
import { describe, expect, it } from "vitest";

import { EmitDocumentRequestSchema } from "./emit-request.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const CLAVE = "1905202601179001234400110010010000001231234567812";

describe("EmitDocumentRequestSchema", () => {
  const base = {
    companyId: ULID,
    ambiente: "1",
    codDoc: "01",
    estab: "001",
    ptoEmi: "001",
    secuencial: "000000123",
    claveAcceso: CLAVE,
    fechaEmision: "19/05/2026",
    tipoEmision: "1",
    factura: { infoTributaria: {}, infoFactura: {}, detalles: [] },
  };

  it("accepts a complete service-to-service request", () => {
    expect(() => EmitDocumentRequestSchema.parse(base)).not.toThrow();
  });

  it("rejects when claveAcceso is malformed", () => {
    // 49 digits, but checksum (last digit) intentionally wrong.
    const bad = `${"1".repeat(48)}0`;
    expect(
      EmitDocumentRequestSchema.safeParse({
        ...base,
        claveAcceso: bad,
      }).success,
    ).toBe(false);
  });

  it("rejects when factura is missing", () => {
    const { factura: _omitted, ...rest } = base;
    expect(EmitDocumentRequestSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when fechaEmision is ISO instead of dd/mm/yyyy", () => {
    expect(
      EmitDocumentRequestSchema.safeParse({ ...base, fechaEmision: "2026-05-19" }).success,
    ).toBe(false);
  });
});
