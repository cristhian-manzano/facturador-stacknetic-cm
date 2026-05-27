/**
 * Tests for `PasaporteSchema`. Per TASKS-0005 §2.5.
 */
import { describe, expect, it } from "vitest";

import { PasaporteSchema } from "./pasaporte.js";

describe("PasaporteSchema", () => {
  it.each([
    ["alphanumeric mid-length", "AB123XYZ"],
    ["single char", "A"],
    ["max length 20", "ABCDEFGHIJ1234567890"],
    ["lowercase only", "passport01"],
  ])("accepts %s", (_label, value) => {
    expect(() => PasaporteSchema.parse(value)).not.toThrow();
  });

  it.each([
    ["empty string", ""],
    ["21 chars (over cap)", "A".repeat(21)],
    ["contains dash", "AB-123"],
    ["contains space", "AB 123"],
    ["contains underscore", "AB_123"],
  ])("rejects %s", (_label, value) => {
    expect(PasaporteSchema.safeParse(value).success).toBe(false);
  });
});
