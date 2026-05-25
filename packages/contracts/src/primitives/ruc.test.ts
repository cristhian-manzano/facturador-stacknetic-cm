/**
 * Tests for `RucSchema`. Per TASKS-0005 §2.3 and SPEC-0005 AC-3.
 *
 * All RUCs in this file are synthetic (computed checksums); none are real
 * taxpayer numbers (PROMPT-0005 §6).
 */
import { describe, expect, it } from "vitest";
import { RucSchema, isValidRuc, isValidRucPersonaNatural, isValidRucSociedad } from "./ruc.js";

describe("RucSchema — sociedad privada (third digit = 9)", () => {
  it.each([
    ["computed fixture 1", "1790012344001"],
    ["computed fixture 2", "1765123451001"],
    ["computed fixture 3", "0990012342001"],
  ])("accepts %s", (_label, value) => {
    expect(() => RucSchema.parse(value)).not.toThrow();
  });

  it("rejects sociedad with bad checksum", () => {
    expect(RucSchema.safeParse("1790012345001").success).toBe(false); // wrong check digit
  });

  it("rejects sociedad not ending in 001", () => {
    expect(RucSchema.safeParse("1790012344002").success).toBe(false);
  });
});

describe("RucSchema — persona natural (derived from cédula)", () => {
  it.each([
    ["1710034065 + 001", "1710034065001"],
    ["1714616123 + 002", "1714616123002"],
    ["0926687856 + 009", "0926687856009"],
  ])("accepts %s", (_label, value) => {
    expect(() => RucSchema.parse(value)).not.toThrow();
  });

  it("rejects persona natural with invalid underlying cédula", () => {
    expect(RucSchema.safeParse("1710034066001").success).toBe(false);
  });

  it("rejects persona natural with 000 suffix (must be 001..009)", () => {
    expect(RucSchema.safeParse("1710034065000").success).toBe(false);
  });
});

describe("RucSchema — generic rejections", () => {
  it.each([
    ["wrong length (3 digits)", "123"],
    ["wrong length (12 digits)", "179001234400"],
    ["wrong length (14 digits)", "17900123440011"],
    ["non-digit", "abcdefghijklm"],
    ["unsupported third digit 7", "1771234567001"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(RucSchema.safeParse(value).success).toBe(false);
  });
});

describe("RUC checksum helpers", () => {
  it("`isValidRuc` is the disjunction of both branches", () => {
    expect(isValidRuc("1790012344001")).toBe(true); // sociedad
    expect(isValidRuc("1710034065001")).toBe(true); // persona natural
    expect(isValidRuc("0000000000000")).toBe(false);
  });

  it("`isValidRucSociedad` rejects persona-natural shape", () => {
    expect(isValidRucSociedad("1710034065001")).toBe(false);
  });

  it("`isValidRucPersonaNatural` rejects sociedad shape with invalid cédula", () => {
    // 179001234 + 4 is a valid sociedad check, but as a cédula the province
    // would be 17 (Pichincha) and third digit 9 is reserved → invalid cédula.
    expect(isValidRucPersonaNatural("1790012344001")).toBe(false);
  });

  // Cover the edge cases of the módulo-11 ternary inside `computeSociedadCheck`.
  it("validates a sociedad RUC whose module-11 yields r === 11 (check 0)", () => {
    expect(isValidRucSociedad("1790000060001")).toBe(true);
  });

  it("validates a sociedad RUC whose module-11 yields r === 10 (check 1)", () => {
    expect(isValidRucSociedad("1790000011001")).toBe(true);
  });
});
