/**
 * Tests for `RoleSchema`.
 */
import { describe, expect, it } from "vitest";
import { RoleSchema } from "./role.js";

describe("RoleSchema", () => {
  it.each([["OWNER"], ["ADMIN"], ["ACCOUNTANT"], ["OPERATOR"], ["VIEWER"]])(
    "accepts %s",
    (role) => {
      expect(RoleSchema.parse(role)).toBe(role);
    },
  );

  it.each([
    ["lowercase", "owner"],
    ["unknown role", "ROOT"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(RoleSchema.safeParse(value).success).toBe(false);
  });
});
