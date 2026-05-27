/**
 * Tests for `EmitDocumentResponseSchema`.
 */
import { describe, expect, it } from "vitest";

import { EmitDocumentResponseSchema } from "./emit-response.js";

const CLAVE = "1905202601179001234400110010010000001231234567812";

describe("EmitDocumentResponseSchema", () => {
  it("accepts an AUTORIZADO response", () => {
    expect(() =>
      EmitDocumentResponseSchema.parse({
        claveAcceso: CLAVE,
        estado: "AUTORIZADO",
        numeroAutorizacion: CLAVE,
        fechaAutorizacion: "2026-05-19T10:00:00.000+00:00",
        signedXmlSha256: "a".repeat(64),
      }),
    ).not.toThrow();
  });

  it("accepts a minimal RECIBIDA response", () => {
    expect(() =>
      EmitDocumentResponseSchema.parse({
        claveAcceso: CLAVE,
        estado: "RECIBIDA",
      }),
    ).not.toThrow();
  });

  it("rejects an uppercase signedXmlSha256", () => {
    expect(
      EmitDocumentResponseSchema.safeParse({
        claveAcceso: CLAVE,
        estado: "AUTORIZADO",
        signedXmlSha256: "A".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("rejects when claveAcceso is invalid", () => {
    // Length OK (49) but checksum (last digit) wrong.
    const bad = `${"1".repeat(48)}0`;
    expect(
      EmitDocumentResponseSchema.safeParse({
        claveAcceso: bad,
        estado: "AUTORIZADO",
      }).success,
    ).toBe(false);
  });
});
