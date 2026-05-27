/**
 * Tests for `SessionTenantSwitchSchema`.
 */
import { describe, expect, it } from "vitest";

import { SessionTenantSwitchSchema } from "./session.js";

describe("SessionTenantSwitchSchema", () => {
  it("accepts a valid ULID companyId", () => {
    expect(() =>
      SessionTenantSwitchSchema.parse({ companyId: "01HX8K0PYFA9B7Y1M2N3P4Q5R6" }),
    ).not.toThrow();
  });

  it("rejects a missing companyId", () => {
    expect(SessionTenantSwitchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-ULID companyId", () => {
    expect(SessionTenantSwitchSchema.safeParse({ companyId: "abc" }).success).toBe(false);
  });
});
