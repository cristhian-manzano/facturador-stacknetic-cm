/**
 * Tests for `SriEventSchema`.
 */
import { describe, expect, it } from "vitest";

import { SriEtapaSchema, SriEventSchema } from "./event.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

describe("SriEventSchema", () => {
  it("accepts a BUILD event", () => {
    expect(() =>
      SriEventSchema.parse({
        id: ULID,
        documentId: ULID,
        etapa: "BUILD",
        estado: "PENDIENTE",
        mensajes: [],
        durationMs: 12,
        createdAt: "2026-05-19T10:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts an AUTHORIZE event carrying mensajes", () => {
    expect(() =>
      SriEventSchema.parse({
        id: ULID,
        documentId: ULID,
        etapa: "AUTHORIZE",
        estado: "AUTORIZADO",
        mensajes: [{ identificador: "1", mensaje: "ok", tipo: "INFORMATIVO" }],
        durationMs: 350,
        createdAt: "2026-05-19T10:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown etapa", () => {
    expect(
      SriEventSchema.safeParse({
        id: ULID,
        documentId: ULID,
        etapa: "REINTENTO",
        estado: "PENDIENTE",
        mensajes: [],
        durationMs: 0,
        createdAt: "2026-05-19T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative durationMs", () => {
    expect(
      SriEventSchema.safeParse({
        id: ULID,
        documentId: ULID,
        etapa: "SEND",
        estado: "ENVIADO",
        mensajes: [],
        durationMs: -1,
        createdAt: "2026-05-19T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("SriEtapaSchema", () => {
  it.each([["BUILD"], ["SIGN"], ["SEND"], ["RECEIVE"], ["AUTHORIZE"], ["POLL"], ["ERROR"]])(
    "accepts %s",
    (etapa) => {
      expect(SriEtapaSchema.parse(etapa)).toBe(etapa);
    },
  );
});
