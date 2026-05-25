/**
 * Trivial smoke test for the `cn` re-export. Keeps the helper in the
 * coverage report (otherwise zero callers would show up as uncovered).
 */
import { describe, expect, it } from "vitest";

import { cn } from "./cn.js";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "")).toBe("a");
  });

  it("supports conditional objects", () => {
    expect(cn({ active: true, hidden: false })).toBe("active");
  });
});
