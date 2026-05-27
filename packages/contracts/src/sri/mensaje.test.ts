/**
 * Tests for `SriMensajeSchema`.
 */
import { describe, expect, it } from "vitest";

import { SriMensajeSchema } from "./mensaje.js";

describe("SriMensajeSchema", () => {
  it("accepts an ERROR mensaje", () => {
    expect(() =>
      SriMensajeSchema.parse({
        identificador: "35",
        mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML",
        tipo: "ERROR",
        informacionAdicional: "elemento totalSinImpuestos",
      }),
    ).not.toThrow();
  });

  it("accepts a minimal INFORMATIVO mensaje", () => {
    expect(() =>
      SriMensajeSchema.parse({
        identificador: "1",
        mensaje: "Comprobante recibido",
        tipo: "INFORMATIVO",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown tipo", () => {
    expect(
      SriMensajeSchema.safeParse({
        identificador: "1",
        mensaje: "x",
        tipo: "URGENTE",
      }).success,
    ).toBe(false);
  });

  it("rejects when identificador is empty", () => {
    expect(
      SriMensajeSchema.safeParse({
        identificador: "",
        mensaje: "x",
        tipo: "ERROR",
      }).success,
    ).toBe(false);
  });
});
