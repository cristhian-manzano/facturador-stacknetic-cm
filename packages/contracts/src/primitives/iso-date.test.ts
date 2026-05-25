/**
 * Tests for `IsoDateSchema`. Per TASKS-0005 §2.8.
 */
import { describe, expect, it } from "vitest";
import { IsoDateSchema } from "./iso-date.js";

describe("IsoDateSchema", () => {
  it.each([
    ["mid-year date", "2026-05-19"],
    ["leap-style date", "2024-02-29"],
    ["year boundary", "2025-12-31"],
  ])("accepts %s", (_label, value) => {
    expect(() => IsoDateSchema.parse(value)).not.toThrow();
  });

  it.each([
    ["European format", "19/05/2026"],
    ["US format", "05-19-2026"],
    ["too short", "2026-5-19"],
    ["with timestamp", "2026-05-19T00:00:00Z"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(IsoDateSchema.safeParse(value).success).toBe(false);
  });
});
