/**
 * Tests for `FechaEmisionSchema` — the SRI `dd/mm/aaaa` shape.
 */
import { describe, expect, it } from "vitest";
import { FechaEmisionSchema } from "./fecha-emision.js";

describe("FechaEmisionSchema", () => {
  it.each([
    ["mid year", "19/05/2026"],
    ["first day of year", "01/01/2025"],
    ["last day of year", "31/12/2099"],
  ])("accepts %s", (_label, value) => {
    expect(() => FechaEmisionSchema.parse(value)).not.toThrow();
  });

  it.each([
    ["ISO form", "2026-05-19"],
    ["month 13", "19/13/2026"],
    ["day 32", "32/05/2026"],
    ["year 1999 (out of range)", "01/01/1999"],
    ["year 3000 (out of range)", "01/01/3000"],
    ["single-digit day", "1/5/2026"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(FechaEmisionSchema.safeParse(value).success).toBe(false);
  });
});
