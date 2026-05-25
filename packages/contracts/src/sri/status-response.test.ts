/**
 * Tests for `DocumentStatusResponseSchema`.
 */
import { describe, expect, it } from "vitest";
import { DocumentStatusResponseSchema } from "./status-response.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const CLAVE = "1905202601179001234400110010010000001231234567812";

describe("DocumentStatusResponseSchema", () => {
  it("accepts a document with empty events", () => {
    expect(() =>
      DocumentStatusResponseSchema.parse({
        document: {
          id: ULID,
          companyId: ULID,
          claveAcceso: CLAVE,
          ambiente: "1",
          codDoc: "01",
          estab: "001",
          ptoEmi: "001",
          secuencial: "000000123",
          fechaEmision: "2026-05-19",
          estado: "PENDIENTE",
          createdAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
        },
        events: [],
      }),
    ).not.toThrow();
  });

  it("rejects when events is missing", () => {
    expect(
      DocumentStatusResponseSchema.safeParse({
        document: {},
      }).success,
    ).toBe(false);
  });
});
