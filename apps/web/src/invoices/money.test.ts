/**
 * `parseMoney` / `formatMoney` / `sumMoney` / `moneyEquals` tests
 * (SPEC-0042 §FR-4 / §7.3 / hard rule: parseMoney rejects unparseable).
 */
import { describe, expect, it } from "vitest";

import { formatMoney, moneyEquals, parseMoney, parseMoneyOrZero, sumMoney } from "./money.js";

describe("parseMoney — happy paths", () => {
  it.each([
    ["100", 100],
    ["100.5", 100.5],
    ["100,50", 100.5],
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["  100  ", 100],
    ["-50.5", -50.5],
    ["0", 0],
    ["0.01", 0.01],
    ["1234567", 1234567],
    ["1.234.567", 1234567],
    ["1,234,567", 1234567],
  ])("parses %s → %s", (input, expected) => {
    const r = parseMoney(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(expected, 4);
  });
});

describe("parseMoney — rejects unparseable", () => {
  it.each(["", "abc", "1.2.3", "12,34,56", "NaN", "Infinity", "1..5", "12,3,4,5"])(
    "rejects %s",
    (input) => {
      const r = parseMoney(input);
      expect(r.ok).toBe(false);
    },
  );

  it("rejects null / undefined / non-string", () => {
    expect(parseMoney(null).ok).toBe(false);
    expect(parseMoney(undefined).ok).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseMoney({} as any).ok).toBe(false);
  });

  it("accepts numbers when finite", () => {
    const r = parseMoney(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("rejects non-finite numbers", () => {
    expect(parseMoney(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseMoney(Number.NaN).ok).toBe(false);
  });
});

describe("parseMoneyOrZero", () => {
  it("returns 0 on parse failure", () => {
    expect(parseMoneyOrZero("abc")).toBe(0);
  });
  it("returns the parsed value on success", () => {
    expect(parseMoneyOrZero("12.34")).toBeCloseTo(12.34);
  });
});

describe("formatMoney", () => {
  it("formats es-EC currency with 2 decimals", () => {
    expect(formatMoney(1234.5)).toMatch(/1[.,]234[.,]50/);
    expect(formatMoney(0)).toMatch(/0[.,]00/);
  });
  it("falls back to $0.00 for non-finite values", () => {
    expect(formatMoney(Number.NaN)).toMatch(/0[.,]00/);
    expect(formatMoney(Number.POSITIVE_INFINITY)).toMatch(/0[.,]00/);
  });
});

describe("sumMoney", () => {
  it("sums valid entries", () => {
    expect(sumMoney(["10", "20.5", "30,5"])).toBeCloseTo(61);
  });
  it("treats unparseable entries as 0", () => {
    expect(sumMoney(["10", "abc", "5"])).toBeCloseTo(15);
  });
  it("rounds to 2 dp", () => {
    // 0.1 + 0.2 in IEEE-754 → 0.30000000000000004
    expect(sumMoney(["0.1", "0.2"])).toBe(0.3);
  });
});

describe("moneyEquals", () => {
  it("tolerates ±0.01", () => {
    expect(moneyEquals(115.0, 115.0)).toBe(true);
    expect(moneyEquals(115.0, 114.99)).toBe(true);
    expect(moneyEquals(115.0, 115.01)).toBe(true);
  });
  it("rejects diffs > 0.01", () => {
    expect(moneyEquals(115.0, 114.98)).toBe(false);
    expect(moneyEquals(115.0, 115.02)).toBe(false);
  });
  it("rejects non-finite values", () => {
    expect(moneyEquals(Number.NaN, 0)).toBe(false);
    expect(moneyEquals(0, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
