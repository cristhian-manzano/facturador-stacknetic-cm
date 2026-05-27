/**
 * Consumer smoke test: import schemas from `@facturador/contracts` through
 * their subpath exports and verify a happy path + a sad path for each.
 *
 * This test is the contract from TASKS-0005 §10.2: it proves that
 *
 *   1. The package's `exports` map resolves correctly from `apps/api`.
 *   2. The published `dist/` matches the spec (subpath imports work without
 *      a deep relative path).
 *   3. Branded primitives are usable by downstream callers without escaping
 *      the type system.
 *
 * If this test ever fails on `import`, the contract has drifted and the
 * downstream apps are broken at runtime.
 */
import { describe, expect, it } from "vitest";

import { LoginRequestSchema } from "@facturador/contracts/auth";
import { RucSchema } from "@facturador/contracts/primitives";

describe("@facturador/contracts consumer smoke", () => {
  it("RucSchema (subpath /primitives) accepts a valid sociedad RUC", () => {
    expect(() => RucSchema.parse("1790012344001")).not.toThrow();
  });

  it("RucSchema rejects an invalid RUC (bad checksum)", () => {
    expect(RucSchema.safeParse("1234567890001").success).toBe(false);
  });

  it("LoginRequestSchema (subpath /auth) accepts a valid login payload and lowercases the email", () => {
    const parsed = LoginRequestSchema.parse({
      email: "USER@Example.com",
      password: "correct-horse",
    });
    expect(parsed.email).toBe("user@example.com");
  });

  it("LoginRequestSchema rejects a too-short password", () => {
    expect(LoginRequestSchema.safeParse({ email: "a@b.io", password: "short" }).success).toBe(
      false,
    );
  });
});
