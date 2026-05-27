/**
 * Tests for `@facturador/utils/db/soft-delete`.
 *
 * Invariants:
 *   - `isActive` literally equals `{ deletedAt: null }` so spreading it
 *     into a Prisma `where` is byte-equivalent.
 *   - `withSoftDelete({})` returns the same `deletedAt: null` filter.
 *   - The input shape is preserved (no other keys removed).
 *   - When the caller passes a stale `deletedAt`, the helper STILL forces
 *     `null` (defensive override per the doc-comment contract).
 *   - The function does not mutate its input.
 */
import { describe, expect, it } from "vitest";

import { isActive, withSoftDelete } from "./soft-delete.js";

describe("isActive", () => {
  it("equals { deletedAt: null } structurally", () => {
    expect(isActive).toEqual({ deletedAt: null });
  });

  it("spreads into a where clause without extra keys", () => {
    const where = { companyId: "01H1", ...isActive };
    expect(where).toEqual({ companyId: "01H1", deletedAt: null });
  });
});

describe("withSoftDelete", () => {
  it("adds deletedAt: null to an otherwise empty where", () => {
    expect(withSoftDelete({})).toEqual({ deletedAt: null });
  });

  it("preserves other keys in the input", () => {
    const out = withSoftDelete({ companyId: "01H1", id: "abc" });
    expect(out).toEqual({ companyId: "01H1", id: "abc", deletedAt: null });
  });

  it("forces deletedAt: null even when caller passed a Date", () => {
    const stale = { companyId: "01H1", deletedAt: new Date("2024-01-01T00:00:00Z") };
    const out = withSoftDelete(stale);
    expect(out.deletedAt).toBeNull();
  });

  it("does not mutate the input object", () => {
    const input = { companyId: "01H1" };
    withSoftDelete(input);
    expect(input).toEqual({ companyId: "01H1" });
    // Defensive: also confirm no `deletedAt` snuck onto the original.
    expect(Object.prototype.hasOwnProperty.call(input, "deletedAt")).toBe(false);
  });

  it("works with nested where clauses (just stays at top level)", () => {
    const out = withSoftDelete({
      companyId: "01H1",
      OR: [{ id: "a" }, { id: "b" }],
    });
    expect(out).toEqual({
      companyId: "01H1",
      OR: [{ id: "a" }, { id: "b" }],
      deletedAt: null,
    });
  });
});
