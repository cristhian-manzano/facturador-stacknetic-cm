/**
 * Tests for `CedulaSchema`. Fixtures use synthetic but checksum-valid values
 * (TASKS-0005 §2.4, PROMPT-0005 §9).
 *
 * `1710034065` is the AC-4 fixture from SPEC-0005.
 */
import { describe, expect, it } from "vitest";
import { CedulaSchema, isValidCedulaChecksum } from "./cedula.js";

describe("CedulaSchema", () => {
  it.each([
    ["spec AC-4 fixture", "1710034065"],
    ["another Pichincha cédula", "1714616123"],
    ["another Guayas cédula", "0926687856"],
  ])("accepts %s", (_label, value) => {
    expect(() => CedulaSchema.parse(value)).not.toThrow();
  });

  it.each([
    ["bad checksum (AC-4 minus 1)", "1710034066"],
    ["wrong length (9 digits)", "171003406"],
    ["wrong length (11 digits)", "17100340651"],
    ["non-digit", "171003406a"],
    ["province 00", "0010034067"],
    ["province 25", "2510034064"],
    ["third digit 6 (reserved)", "1760000004"],
    ["third digit 9 (reserved)", "1790000007"],
  ])("rejects %s", (_label, value) => {
    expect(CedulaSchema.safeParse(value).success).toBe(false);
  });
});

describe("isValidCedulaChecksum (helper)", () => {
  it("returns false for empty string", () => {
    expect(isValidCedulaChecksum("")).toBe(false);
  });
});
