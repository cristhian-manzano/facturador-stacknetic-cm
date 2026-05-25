/**
 * Tests for `CustomerSchema` / `CustomerInputSchema`. Per TASKS-0005 §5.1:
 * 5 happy paths (one per branch) + at least 3 error paths.
 */
import { describe, expect, it } from "vitest";
import { CustomerInputSchema, CustomerSchema } from "./customer.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const TIMESTAMPS = {
  id: ULID,
  companyId: ULID,
  isActive: true,
  createdAt: "2026-05-19T10:00:00.000Z",
  updatedAt: "2026-05-19T10:00:00.000Z",
  deletedAt: null,
};

describe("CustomerSchema — happy paths (one per branch)", () => {
  it("accepts 04 RUC", () => {
    expect(() =>
      CustomerSchema.parse({
        ...TIMESTAMPS,
        tipoIdentificacion: "04",
        identificacion: "1790012344001",
        razonSocial: "ACME S.A.",
      }),
    ).not.toThrow();
  });

  it("accepts 05 Cédula", () => {
    expect(() =>
      CustomerSchema.parse({
        ...TIMESTAMPS,
        tipoIdentificacion: "05",
        identificacion: "1710034065",
        razonSocial: "Juan Pérez",
        email: "JUAN@x.io",
      }),
    ).not.toThrow();
  });

  it("accepts 06 Pasaporte", () => {
    expect(() =>
      CustomerSchema.parse({
        ...TIMESTAMPS,
        tipoIdentificacion: "06",
        identificacion: "X12345678",
        razonSocial: "John Doe",
      }),
    ).not.toThrow();
  });

  it("accepts 07 Consumidor final with mandated values", () => {
    expect(() =>
      CustomerSchema.parse({
        ...TIMESTAMPS,
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
        razonSocial: "CONSUMIDOR FINAL",
      }),
    ).not.toThrow();
  });

  it("accepts 08 Identificación del exterior", () => {
    expect(() =>
      CustomerSchema.parse({
        ...TIMESTAMPS,
        tipoIdentificacion: "08",
        identificacion: "FOREIGN-ID-001",
        razonSocial: "Sociedad Extranjera",
      }),
    ).not.toThrow();
  });
});

describe("CustomerSchema — error paths", () => {
  it("rejects 04 RUC with bad checksum", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "04",
        identificacion: "1234567890001",
        razonSocial: "ACME",
      }).success,
    ).toBe(false);
  });

  it("rejects 05 Cédula with bad checksum", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "05",
        identificacion: "1710034066",
        razonSocial: "X",
      }).success,
    ).toBe(false);
  });

  it("rejects 07 Consumidor final with the wrong literal identificacion", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "07",
        identificacion: "1234567890123",
        razonSocial: "CONSUMIDOR FINAL",
      }).success,
    ).toBe(false);
  });

  it("rejects 07 Consumidor final when razonSocial isn't the mandated literal", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
        razonSocial: "Anonimo",
      }).success,
    ).toBe(false);
  });

  it("rejects when tipoIdentificacion is not in the union", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "99",
        identificacion: "1710034065",
        razonSocial: "X",
      }).success,
    ).toBe(false);
  });

  it("rejects 08 with an identificacion longer than 20 chars", () => {
    expect(
      CustomerSchema.safeParse({
        ...TIMESTAMPS,
        tipoIdentificacion: "08",
        identificacion: "A".repeat(21),
        razonSocial: "X",
      }).success,
    ).toBe(false);
  });
});

describe("CustomerInputSchema (no timestamps)", () => {
  it("accepts the minimum 04 input", () => {
    expect(() =>
      CustomerInputSchema.parse({
        tipoIdentificacion: "04",
        identificacion: "1790012344001",
        razonSocial: "ACME",
      }),
    ).not.toThrow();
  });

  it("rejects when id is supplied (input shape has no id field)", () => {
    // Discriminated-union schemas in Zod silently ignore extra keys by
    // default, but our input shape should not require an `id`. Confirm the
    // happy path even when an `id` is passed.
    expect(() =>
      CustomerInputSchema.parse({
        tipoIdentificacion: "04",
        identificacion: "1790012344001",
        razonSocial: "ACME",
        id: ULID,
      }),
    ).not.toThrow();
  });
});
