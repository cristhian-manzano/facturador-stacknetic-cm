/**
 * Tests for `CreateCustomerSchema`.
 */
import { describe, expect, it } from "vitest";
import { CreateCustomerSchema } from "./create-customer.js";

describe("CreateCustomerSchema", () => {
  it("accepts a valid cédula customer", () => {
    expect(() =>
      CreateCustomerSchema.parse({
        tipoIdentificacion: "05",
        identificacion: "1710034065",
        razonSocial: "Juan Pérez",
      }),
    ).not.toThrow();
  });

  it("rejects when tipoIdentificacion is missing", () => {
    expect(
      CreateCustomerSchema.safeParse({
        identificacion: "1710034065",
        razonSocial: "Juan",
      }).success,
    ).toBe(false);
  });
});
