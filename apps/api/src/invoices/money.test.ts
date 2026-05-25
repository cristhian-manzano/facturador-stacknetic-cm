/**
 * Tests for `money.ts` — decimal.js HALF_UP money primitives.
 *
 * Surface under test (per PROMPT-0032 §3 + SPEC-0032 §6.2):
 *   - `round2` rounds 2 dp HALF_UP and preserves negatives.
 *   - `round6` rounds 6 dp HALF_UP for cantidad/precioUnitario.
 *   - `decimalToNumber` / `decimalToMoneyString` produce the contract shape.
 *   - `sum` adds without rounding and stays decimal-safe for long lists.
 *   - All math runs through `Decimal`; no native float arithmetic. The
 *     `0.1 + 0.2` round-trip is the canonical proof point.
 *   - Edge values: 0, very large totals (12-digit headroom), boundary
 *     half-up rounding (e.g. 0.005 → 0.01).
 *
 * Synthetic data only — no PII, no real-world totals.
 */
import { describe, expect, it } from "vitest";
import {
  Decimal,
  MONEY_DP,
  QTY_DP,
  decimalToMoneyString,
  decimalToNumber,
  round2,
  round6,
  sum,
} from "./money.js";

describe("round2 — HALF_UP at 2 decimal places", () => {
  it("rounds 0.005 up to 0.01 (HALF_UP, not banker's)", () => {
    // Banker's rounding would round 0.005 to 0.00; HALF_UP rounds to 0.01.
    // This is the contract per the SPEC-0032 §6.2 rationale.
    expect(round2("0.005").toString()).toBe("0.01");
  });

  it("rounds 0.015 up to 0.02 (HALF_UP)", () => {
    expect(round2("0.015").toString()).toBe("0.02");
  });

  it("rounds 0.014 down to 0.01", () => {
    expect(round2("0.014").toString()).toBe("0.01");
  });

  it("rounds 0.116 up to 0.12", () => {
    expect(round2("0.116").toString()).toBe("0.12");
  });

  it("rounds the canonical 0.1+0.2 float-drift to 0.30", () => {
    // In native JS: `0.1 + 0.2 === 0.30000000000000004`. Through Decimal it
    // round-trips to 0.30 — the whole point of using decimal.js.
    const d = new Decimal("0.1").plus("0.2");
    expect(round2(d).toString()).toBe("0.3");
  });

  it("is idempotent (round2(round2(x)) === round2(x))", () => {
    const x = new Decimal("123.456");
    const once = round2(x);
    const twice = round2(once);
    expect(twice.equals(once)).toBe(true);
  });

  it("accepts string, number, and Decimal inputs equivalently", () => {
    expect(round2("100.005").toString()).toBe(round2(new Decimal("100.005")).toString());
    // Number inputs are coerced through decimal.js; this avoids the
    // 0.1+0.2 trap because the input is already rounded to 2 dp.
    expect(round2(100.5).toString()).toBe("100.5");
  });

  it("preserves zero", () => {
    expect(round2(0).toString()).toBe("0");
    expect(round2("0").toString()).toBe("0");
    expect(round2(new Decimal(0)).toString()).toBe("0");
  });

  it("handles large values up to the 14,2 column ceiling without drift", () => {
    // Postgres column is Decimal(14,2). The largest representable money
    // value is 999_999_999_999.99 — well within decimal.js precision.
    const big = new Decimal("999999999999.99");
    expect(round2(big).toFixed(MONEY_DP)).toBe("999999999999.99");
  });

  it("rounds negative half-up away from zero (HALF_UP semantics in decimal.js)", () => {
    // decimal.js HALF_UP rounds away from zero on the half. `-0.005`
    // therefore becomes `-0.01`. We don't *use* negative money in
    // production, but the math is well-defined and worth pinning.
    expect(round2("-0.005").toString()).toBe("-0.01");
  });
});

describe("round6 — HALF_UP at 6 decimal places", () => {
  it("rounds 0.0000005 up to 0.000001", () => {
    expect(round6("0.0000005").toString()).toBe("0.000001");
  });

  it("rounds 0.0000004 down to 0", () => {
    expect(round6("0.0000004").toString()).toBe("0");
  });

  it("is idempotent for a 6-dp value", () => {
    const x = new Decimal("1.234567");
    expect(round6(x).equals(x)).toBe(true);
  });

  it("preserves 6 dp on a quantity (no truncation)", () => {
    expect(round6("12.345678").toString()).toBe("12.345678");
  });

  it("constants surface the expected decimal places", () => {
    expect(MONEY_DP).toBe(2);
    expect(QTY_DP).toBe(6);
  });
});

describe("sum — Decimal aggregation", () => {
  it("returns 0 (Decimal) for an empty list", () => {
    const s = sum([]);
    expect(s.equals(0)).toBe(true);
  });

  it("adds a list of strings without float drift", () => {
    // 0.1 + 0.1 + 0.1 = 0.3 (NOT 0.30000000000000004).
    const s = sum(["0.1", "0.1", "0.1"]);
    expect(s.toFixed(MONEY_DP)).toBe("0.30");
  });

  it("adds mixed Decimal/string/number inputs", () => {
    const s = sum([new Decimal("1"), "2.5", 3]);
    expect(s.toString()).toBe("6.5");
  });

  it("aggregates 1000 random 2-dp values without precision loss", () => {
    // Build a list of 1000 0.01 values; sum must be exactly 10.00.
    const vals = Array.from({ length: 1000 }, () => "0.01");
    expect(sum(vals).toFixed(MONEY_DP)).toBe("10.00");
  });

  it("does NOT round (the caller picks the rounding moment)", () => {
    // sum-of-0.001 ten times = 0.010 exact; no implicit round happens
    // until the caller invokes round2.
    const s = sum([
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
      "0.001",
    ]);
    expect(s.toString()).toBe("0.01");
    // Sanity: an unrounded fractional sum keeps its tail.
    const s2 = sum(["0.001", "0.001", "0.001"]);
    expect(s2.toString()).toBe("0.003");
  });
});

describe("decimalToNumber — JSON boundary helper", () => {
  it("converts a Decimal to a number with 2 dp", () => {
    expect(decimalToNumber(new Decimal("123.456"))).toBe(123.46);
    expect(decimalToNumber(new Decimal("0"))).toBe(0);
    expect(decimalToNumber(new Decimal("0.10"))).toBe(0.1);
  });

  it("preserves an already-rounded Decimal exactly at 2 dp", () => {
    expect(decimalToNumber(round2("15.00"))).toBe(15);
    expect(decimalToNumber(round2("100.05"))).toBe(100.05);
    expect(decimalToNumber(round2("999999999999.99"))).toBe(999999999999.99);
  });
});

describe("decimalToMoneyString — XML boundary helper", () => {
  it("renders a Decimal with exactly 2 dp", () => {
    expect(decimalToMoneyString(new Decimal("15"))).toBe("15.00");
    expect(decimalToMoneyString(new Decimal("0"))).toBe("0.00");
    expect(decimalToMoneyString(new Decimal("100.5"))).toBe("100.50");
  });

  it("renders the canonical 0.30 (no trailing exp notation)", () => {
    const d = new Decimal("0.1").plus("0.2");
    expect(decimalToMoneyString(round2(d))).toBe("0.30");
  });
});

describe("mul / add / sub round-trips through Decimal arithmetic", () => {
  it("(a * b) round-trips at 2 dp for a 15% IVA computation", () => {
    // Worked example: 1 * 100 * 0.15 = 15.00; precondition for compute.ts.
    const subtotal = new Decimal(1).mul(100);
    const iva = subtotal.mul(15).div(100);
    expect(round2(iva).toString()).toBe("15");
  });

  it("(a + b - b) round-trips to a (no drift)", () => {
    const a = new Decimal("123.45");
    const b = new Decimal("67.89");
    const result = a.plus(b).minus(b);
    expect(result.equals(a)).toBe(true);
  });

  it("compose subtract then round still gives a stable money string", () => {
    // 100.00 - 0.01 = 99.99 exact.
    expect(round2(new Decimal("100.00").minus("0.01")).toFixed(MONEY_DP)).toBe("99.99");
  });

  it("repeats the same product 100 times without precision drift", () => {
    // Aggregate 100 copies of 0.07 — pure decimal must give 7.00 exactly.
    let total = new Decimal(0);
    for (let i = 0; i < 100; i++) total = total.plus("0.07");
    expect(round2(total).toFixed(MONEY_DP)).toBe("7.00");
  });
});
