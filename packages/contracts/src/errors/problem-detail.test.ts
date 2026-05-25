/**
 * Tests for `ProblemDetailSchema`. Per TASKS-0005 §8.1 + SPEC-0006 §AC-1.
 */
import { describe, expect, it } from "vitest";
import { ProblemDetailSchema } from "./problem-detail.js";

describe("ProblemDetailSchema", () => {
  it("accepts a minimal 400 envelope", () => {
    expect(() =>
      ProblemDetailSchema.parse({
        title: "Validation failed",
        status: 400,
        code: "validation.failed",
      }),
    ).not.toThrow();
  });

  it("accepts a 422 with SRI mensajes", () => {
    expect(() =>
      ProblemDetailSchema.parse({
        type: "urn:facturador:error:sri.devuelta",
        title: "SRI rejected at recepción",
        status: 422,
        code: "sri.devuelta",
        detail: "Revisar 'totalSinImpuestos'",
        instance: "01HX8K0PYFA9B7Y1M2N3P4Q5R6",
        errors: [
          {
            identificador: "35",
            mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML",
            tipo: "ERROR",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects when code contains uppercase letters", () => {
    expect(
      ProblemDetailSchema.safeParse({
        title: "x",
        status: 400,
        code: "Validation.Failed",
      }).success,
    ).toBe(false);
  });

  it("rejects when status is below 100", () => {
    expect(ProblemDetailSchema.safeParse({ title: "x", status: 99, code: "x.y" }).success).toBe(
      false,
    );
  });

  it("rejects when status is 600+", () => {
    expect(ProblemDetailSchema.safeParse({ title: "x", status: 600, code: "x.y" }).success).toBe(
      false,
    );
  });

  it("rejects when errors items violate SriMensajeSchema", () => {
    expect(
      ProblemDetailSchema.safeParse({
        title: "x",
        status: 400,
        code: "x.y",
        errors: [{ identificador: "1", mensaje: "x", tipo: "URGENTE" }],
      }).success,
    ).toBe(false);
  });
});
