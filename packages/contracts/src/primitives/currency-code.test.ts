/**
 * Tests for `CurrencyCodeSchema`. Per TASKS-0005 §2.9.
 */
import { describe, expect, it } from "vitest";
import { CurrencyCodeSchema } from "./currency-code.js";

describe("CurrencyCodeSchema", () => {
  it("accepts 'DOLAR' (the only v1 value)", () => {
    expect(CurrencyCodeSchema.parse("DOLAR")).toBe("DOLAR");
  });

  it.each([
    ["ISO USD", "USD"],
    ["lowercase", "dolar"],
    ["empty", ""],
    ["other currency", "EUR"],
  ])("rejects %s", (_label, value) => {
    expect(CurrencyCodeSchema.safeParse(value).success).toBe(false);
  });
});
