/**
 * Tests for `EstabSchema`, `PtoEmiSchema`, `SecuencialSchema`.
 */
import { describe, expect, it } from "vitest";

import { EstabSchema, PtoEmiSchema, SecuencialSchema } from "./establecimiento.js";

describe("EstabSchema", () => {
  it("accepts 3-digit estab", () => {
    expect(() => EstabSchema.parse("001")).not.toThrow();
  });

  it.each([
    ["too short", "01"],
    ["too long", "0001"],
    ["non-digit", "A01"],
  ])("rejects %s", (_label, value) => {
    expect(EstabSchema.safeParse(value).success).toBe(false);
  });
});

describe("PtoEmiSchema", () => {
  it("accepts 3-digit ptoEmi", () => {
    expect(() => PtoEmiSchema.parse("002")).not.toThrow();
  });

  it("rejects 2-digit ptoEmi", () => {
    expect(PtoEmiSchema.safeParse("02").success).toBe(false);
  });
});

describe("SecuencialSchema", () => {
  it("accepts 9-digit secuencial", () => {
    expect(() => SecuencialSchema.parse("000000123")).not.toThrow();
  });

  it("rejects 8-digit secuencial", () => {
    expect(SecuencialSchema.safeParse("00000012").success).toBe(false);
  });

  it("rejects 10-digit secuencial", () => {
    expect(SecuencialSchema.safeParse("0000000123").success).toBe(false);
  });
});
