/**
 * Tests for the auth login schemas.
 */
import { describe, expect, it } from "vitest";
import { LoginRequestSchema, LoginResponseSchema, MeResponseSchema } from "./login.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

describe("LoginRequestSchema", () => {
  it("accepts a valid payload and lowercases the email", () => {
    const parsed = LoginRequestSchema.parse({
      email: "USER@Example.com",
      password: "correct-horse",
    });
    expect(parsed.email).toBe("user@example.com");
    expect(parsed.password).toBe("correct-horse");
  });

  it("rejects a too-short password", () => {
    expect(LoginRequestSchema.safeParse({ email: "a@b.io", password: "short" }).success).toBe(
      false,
    );
  });

  it("rejects a password over 72 chars", () => {
    expect(
      LoginRequestSchema.safeParse({ email: "a@b.io", password: "x".repeat(73) }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      LoginRequestSchema.safeParse({ email: "not-email", password: "longenough" }).success,
    ).toBe(false);
  });
});

describe("LoginResponseSchema", () => {
  const base = {
    user: { id: ULID, email: "user@example.com", displayName: "User" },
    memberships: [{ companyId: ULID, razonSocial: "ACME", role: "OWNER" as const }],
    activeCompanyId: ULID,
    csrfToken: "csrf-token-value",
  };

  it("accepts a full response", () => {
    expect(() => LoginResponseSchema.parse(base)).not.toThrow();
  });

  it("accepts a response with no active tenant (nullable)", () => {
    expect(() => LoginResponseSchema.parse({ ...base, activeCompanyId: null })).not.toThrow();
  });

  it("rejects when csrfToken is empty", () => {
    expect(LoginResponseSchema.safeParse({ ...base, csrfToken: "" }).success).toBe(false);
  });
});

describe("MeResponseSchema", () => {
  it("accepts a minimal me response (no active tenant)", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: { id: ULID, email: "user@example.com", displayName: "User" },
        memberships: [],
        activeCompanyId: null,
        currentRole: null,
        permissions: [],
      }),
    ).not.toThrow();
  });

  it("accepts a me response with an active tenant + role + permissions", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: { id: ULID, email: "user@example.com", displayName: "User" },
        memberships: [{ companyId: ULID, razonSocial: "ACME", role: "OWNER" }],
        activeCompanyId: ULID,
        currentRole: "OWNER",
        permissions: ["tenant.read", "invoice.create", "certificate.manage"],
      }),
    ).not.toThrow();
  });

  it("rejects when user.id is not a ULID", () => {
    expect(
      MeResponseSchema.safeParse({
        user: { id: "abc", email: "user@example.com", displayName: "U" },
        memberships: [],
        activeCompanyId: null,
        currentRole: null,
        permissions: [],
      }).success,
    ).toBe(false);
  });

  it("rejects when currentRole is missing", () => {
    expect(
      MeResponseSchema.safeParse({
        user: { id: ULID, email: "user@example.com", displayName: "U" },
        memberships: [],
        activeCompanyId: null,
        permissions: [],
      }).success,
    ).toBe(false);
  });

  it("rejects when permissions is missing", () => {
    expect(
      MeResponseSchema.safeParse({
        user: { id: ULID, email: "user@example.com", displayName: "U" },
        memberships: [],
        activeCompanyId: null,
        currentRole: null,
      }).success,
    ).toBe(false);
  });
});
