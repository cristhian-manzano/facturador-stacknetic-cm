/**
 * Tests for `MembershipSummarySchema`, `MembershipSchema`, and the SPEC-0011
 * member-management contracts (`MemberListItem`, `AddMember`,
 * `UpdateMemberRole`).
 */
import { describe, expect, it } from "vitest";
import {
  AddMemberSchema,
  MemberListItemSchema,
  MembershipSchema,
  MembershipSummarySchema,
  UpdateMemberRoleSchema,
} from "./membership.js";

const ULID = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
const ULID_2 = "01HX8K0PYFA9B7Y1M2N3P4Q5R7";

describe("MembershipSummarySchema", () => {
  it("accepts a complete summary", () => {
    expect(() =>
      MembershipSummarySchema.parse({
        companyId: ULID,
        razonSocial: "ACME S.A.",
        role: "OWNER",
      }),
    ).not.toThrow();
  });

  it("rejects when razonSocial is empty", () => {
    expect(
      MembershipSummarySchema.safeParse({
        companyId: ULID,
        razonSocial: "",
        role: "OWNER",
      }).success,
    ).toBe(false);
  });

  it("rejects when role is unknown", () => {
    expect(
      MembershipSummarySchema.safeParse({
        companyId: ULID,
        razonSocial: "ACME",
        role: "ROOT",
      }).success,
    ).toBe(false);
  });
});

describe("MembershipSchema", () => {
  const base = {
    id: ULID,
    companyId: ULID_2,
    userId: ULID,
    role: "ADMIN" as const,
    invitedByUserId: null,
    invitedEmail: null,
    acceptedAt: "2026-05-19T10:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
  };

  it("accepts a full membership", () => {
    expect(() => MembershipSchema.parse(base)).not.toThrow();
  });

  it("rejects when createdAt is not ISO datetime", () => {
    expect(MembershipSchema.safeParse({ ...base, createdAt: "yesterday" }).success).toBe(false);
  });
});

describe("MemberListItemSchema", () => {
  it("accepts a full row", () => {
    expect(() =>
      MemberListItemSchema.parse({
        userId: ULID,
        email: "alice@example.com",
        displayName: "Alice",
        role: "OPERATOR",
      }),
    ).not.toThrow();
  });

  it("rejects when role is unknown", () => {
    expect(
      MemberListItemSchema.safeParse({
        userId: ULID,
        email: "x@y.io",
        displayName: "X",
        role: "ROOT",
      }).success,
    ).toBe(false);
  });
});

describe("AddMemberSchema", () => {
  it("accepts a userId + role pair", () => {
    expect(() => AddMemberSchema.parse({ userId: ULID, role: "VIEWER" })).not.toThrow();
  });

  it("rejects a missing userId", () => {
    expect(AddMemberSchema.safeParse({ role: "VIEWER" }).success).toBe(false);
  });

  it("rejects a non-ULID userId", () => {
    expect(AddMemberSchema.safeParse({ userId: "abc", role: "VIEWER" }).success).toBe(false);
  });
});

describe("UpdateMemberRoleSchema", () => {
  it("accepts a valid role", () => {
    expect(() => UpdateMemberRoleSchema.parse({ role: "ADMIN" })).not.toThrow();
  });

  it("rejects an empty body", () => {
    expect(UpdateMemberRoleSchema.safeParse({}).success).toBe(false);
  });
});
