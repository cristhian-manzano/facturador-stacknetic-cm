/**
 * Tests for `MoneySchema` and `MoneyQtySchema`. Per TASKS-0005 §2.7.
 */
import { describe, expect, it } from "vitest";

import { MoneyQtySchema, MoneySchema } from "./money.js";

describe("MoneySchema", () => {
  it.each([
    ["zero", 0],
    ["one cent", 0.01],
    ["common total", 1234.56],
    ["large round amount", 999_999_999.99],
  ])("accepts %s", (_label, value) => {
    expect(() => MoneySchema.parse(value)).not.toThrow();
  });

  it.each([
    ["negative", -1],
    ["three decimals", 0.001],
    ["NaN", Number.NaN],
    ["non-number string", "1.00" as unknown],
  ])("rejects %s", (_label, value) => {
    expect(MoneySchema.safeParse(value).success).toBe(false);
  });
});

describe("MoneyQtySchema", () => {
  it.each([
    ["integer quantity", 1],
    ["6-decimal quantity", 1.500_000],
    ["fractional quantity", 0.000_001],
  ])("accepts %s", (_label, value) => {
    expect(() => MoneyQtySchema.parse(value)).not.toThrow();
  });

  it("rejects 7-decimal quantity", () => {
    // 1.0000007 has 7 decimal places and is not a multiple of 1e-6.
    expect(MoneyQtySchema.safeParse(1.000_000_7).success).toBe(false);
  });

  it("rejects negative quantity", () => {
    expect(MoneyQtySchema.safeParse(-1).success).toBe(false);
  });

  it("rejects 7-decimal quantity (1.0000001)", () => {
    expect(MoneyQtySchema.safeParse(1.000_000_1).success).toBe(false);
  });
});
