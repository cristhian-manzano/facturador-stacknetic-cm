/**
 * Tests for `UpdateCustomerSchema`.
 */
import { describe, expect, it } from "vitest";
import { UpdateCustomerSchema } from "./update-customer.js";

describe("UpdateCustomerSchema", () => {
  it("accepts a single-field update", () => {
    expect(() => UpdateCustomerSchema.parse({ telefono: "0991234567" })).not.toThrow();
  });

  it("accepts a multi-field update with lowercased email", () => {
    const parsed = UpdateCustomerSchema.parse({
      razonSocial: "Nueva Razón",
      email: "NEW@Example.com",
    });
    expect(parsed.email).toBe("new@example.com");
  });

  it("rejects an empty update body", () => {
    expect(UpdateCustomerSchema.safeParse({}).success).toBe(false);
  });

  it("rejects when razonSocial is empty string", () => {
    expect(UpdateCustomerSchema.safeParse({ razonSocial: "" }).success).toBe(false);
  });
});
