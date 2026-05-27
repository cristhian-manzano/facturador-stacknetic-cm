/**
 * Tests for `UlidSchema`. Per TASKS-0005 §2.1: positive + negative cases.
 */
import { describe, expect, it } from "vitest";

import { UlidSchema } from "./ulid.js";

describe("UlidSchema", () => {
  it("accepts a valid Crockford-base32 ULID", () => {
    const ulid = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";
    expect(UlidSchema.parse(ulid)).toBe(ulid);
  });

  it("accepts another valid ULID with uppercase letters only", () => {
    // 26 chars from the Crockford alphabet (no I, L, O, U).
    expect(() => UlidSchema.parse("01ARZ3NDEKTSV4RRFFQ69G5FAV")).not.toThrow();
  });

  it.each([
    ["too short", "abc"],
    ["lowercase letters", "01hx8k0pyfa9b7y1m2n3p4q5r6"],
    ["forbidden letter I", "01HX8K0PYFA9B7Y1M2N3P4Q5RI"],
    ["forbidden letter L", "01HX8K0PYFA9B7Y1M2N3P4Q5RL"],
    ["forbidden letter O", "01HX8K0PYFA9B7Y1M2N3P4Q5RO"],
    ["forbidden letter U", "01HX8K0PYFA9B7Y1M2N3P4Q5RU"],
    ["27 chars", "01HX8K0PYFA9B7Y1M2N3P4Q5R67"],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(UlidSchema.safeParse(value).success).toBe(false);
  });
});
