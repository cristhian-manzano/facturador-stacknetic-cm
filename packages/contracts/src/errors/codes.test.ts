/**
 * Tests for the `ErrorCodes` taxonomy.
 *
 * The most important invariant: every value matches the same regex used
 * by `ProblemDetailSchema.code` (kept in `problem-detail.ts`). If the
 * regex tightens, the test fails fast and forces the taxonomy to follow.
 *
 * We also assert:
 *   - The constant is FROZEN at compile time (`as const`) — verified by
 *     reading from a typed key.
 *   - No two codes collide on the same value (typo-protection).
 *   - The set is non-empty (sanity).
 */
import { describe, expect, it } from "vitest";

import { ErrorCodes } from "./codes.js";

// Source-of-truth regex — mirrored from `problem-detail.ts`. Kept here
// (and not imported) so a refactor that drops the schema regex still
// trips the test until both sides update together.
const CODE_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

describe("ErrorCodes taxonomy", () => {
  it("contains at least one code (sanity)", () => {
    expect(Object.values(ErrorCodes).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(ErrorCodes))(
    "%s value matches the ProblemDetail.code regex",
    (_label, value) => {
      expect(value).toMatch(CODE_REGEX);
    },
  );

  it("has no duplicate values across keys", () => {
    const values = Object.values(ErrorCodes);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("uses snake_case identifiers (no camelCase, no kebab-case)", () => {
    for (const value of Object.values(ErrorCodes)) {
      expect(value).not.toMatch(/[A-Z]/);
      expect(value).not.toMatch(/-/);
    }
  });

  it("contains the expected critical codes", () => {
    // Pin a few well-known codes so renames break the test (forcing
    // intentional contract updates).
    expect(ErrorCodes.VALIDATION_FAILED).toBe("validation.failed");
    expect(ErrorCodes.AUTH_UNAUTHENTICATED).toBe("auth.unauthenticated");
    expect(ErrorCodes.TENANT_FORBIDDEN).toBe("tenant.forbidden");
    expect(ErrorCodes.INTERNAL_UNEXPECTED).toBe("internal.unexpected");
  });
});
