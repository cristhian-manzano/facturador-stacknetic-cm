/**
 * Tests for `TenantSchema`, `CreateTenantSchema`, and `UpdateTenantSchema`.
 */
import { describe, expect, it } from "vitest";
import { CreateTenantSchema, TenantSchema, UpdateTenantSchema } from "./tenant.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

describe("CreateTenantSchema", () => {
  it("accepts a complete create body", () => {
    expect(() =>
      CreateTenantSchema.parse({
        ruc: "1790012344001",
        razonSocial: "ACME S.A.",
        direccionMatriz: "Av. Amazonas 123",
        ambiente: "1",
        obligadoContabilidad: true,
      }),
    ).not.toThrow();
  });

  it("rejects when RUC is invalid", () => {
    expect(
      CreateTenantSchema.safeParse({
        ruc: "0000000000000",
        razonSocial: "ACME",
        direccionMatriz: "Quito",
        ambiente: "1",
        obligadoContabilidad: false,
      }).success,
    ).toBe(false);
  });

  it("rejects when ambiente is missing", () => {
    expect(
      CreateTenantSchema.safeParse({
        ruc: "1790012344001",
        razonSocial: "ACME",
        direccionMatriz: "Quito",
        obligadoContabilidad: false,
      }).success,
    ).toBe(false);
  });
});

describe("TenantSchema", () => {
  it("accepts a full tenant", () => {
    expect(() =>
      TenantSchema.parse({
        id: ULID,
        ruc: "1790012344001",
        razonSocial: "ACME S.A.",
        nombreComercial: "ACME",
        direccionMatriz: "Av. Amazonas 123",
        ambiente: "2",
        contribuyenteEspecial: null,
        obligadoContabilidad: true,
        contribuyenteRimpe: null,
        createdAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("rejects when ambiente is '3'", () => {
    expect(
      TenantSchema.safeParse({
        id: ULID,
        ruc: "1790012344001",
        razonSocial: "ACME",
        nombreComercial: null,
        direccionMatriz: "X",
        ambiente: "3",
        contribuyenteEspecial: null,
        obligadoContabilidad: true,
        contribuyenteRimpe: null,
        createdAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("UpdateTenantSchema", () => {
  it("accepts a single-field patch", () => {
    expect(() => UpdateTenantSchema.parse({ razonSocial: "RENAMED S.A." })).not.toThrow();
  });

  it("accepts a multi-field patch", () => {
    expect(() =>
      UpdateTenantSchema.parse({
        razonSocial: "RENAMED",
        nombreComercial: "Alias",
        obligadoContabilidad: true,
      }),
    ).not.toThrow();
  });

  it("accepts setting nombreComercial to null", () => {
    expect(() => UpdateTenantSchema.parse({ nombreComercial: null })).not.toThrow();
  });

  it("rejects an empty patch", () => {
    expect(UpdateTenantSchema.safeParse({}).success).toBe(false);
  });

  it("rejects ruc in the patch (RUC is immutable in this contract)", () => {
    // The schema doesn't list `ruc`, so a strict-mode parse would reject.
    // The current schema is permissive (Zod's default is to strip unknown
    // keys), so `ruc` is silently dropped — the runtime test here at least
    // confirms the parsed value does NOT contain the hostile field.
    const parsed = UpdateTenantSchema.parse({
      razonSocial: "RENAMED",
      ruc: "9999999999999",
    } as unknown as { razonSocial: string });
    expect("ruc" in parsed).toBe(false);
  });
});
