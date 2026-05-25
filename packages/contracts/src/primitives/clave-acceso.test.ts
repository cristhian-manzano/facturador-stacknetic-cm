/**
 * Tests for `ClaveAccesoSchema`. Per TASKS-0005 §2.6 and SPEC-0005 AC-2.
 *
 * Fixture composition (48 base digits):
 *   - fechaEmision = 19052026
 *   - codDoc       = 01 (factura)
 *   - ruc          = 1790012344001
 *   - ambiente     = 1 (pruebas)
 *   - serie        = 001001 (estab + ptoEmi)
 *   - secuencial   = 000000123
 *   - codigoNumerico = 12345678
 *   - tipoEmision  = 1
 *   - verifier (49th) = 2
 *
 * The full 49-digit value `1905202601179001234400110010010000001231234567812`
 * was computed offline with the algorithm in SPEC-0022 §6.2.
 */
import { describe, expect, it } from "vitest";
import {
  ClaveAccesoSchema,
  computeClaveAccesoCheckDigit,
  isValidClaveAcceso,
} from "./clave-acceso.js";

const VALID = "1905202601179001234400110010010000001231234567812";

describe("ClaveAccesoSchema", () => {
  it("accepts a known-valid 49-digit clave", () => {
    expect(() => ClaveAccesoSchema.parse(VALID)).not.toThrow();
  });

  it("rejects the same clave with its last digit tampered (off by 1)", () => {
    // Replace the verifier digit "2" with "3" → checksum mismatch.
    const tampered = `${VALID.slice(0, 48)}3`;
    expect(ClaveAccesoSchema.safeParse(tampered).success).toBe(false);
  });

  it.each([
    ["wrong length (48)", VALID.slice(0, 48)],
    ["wrong length (50)", `${VALID}0`],
    ["contains a letter", `${VALID.slice(0, 48)}A`],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(ClaveAccesoSchema.safeParse(value).success).toBe(false);
  });
});

describe("computeClaveAccesoCheckDigit", () => {
  it("computes the documented digit for the fixture base48", () => {
    expect(computeClaveAccesoCheckDigit(VALID.slice(0, 48))).toBe("2");
  });

  it("`isValidClaveAcceso` returns false on non-digit input", () => {
    expect(isValidClaveAcceso("not-a-number")).toBe(false);
  });

  // Edge cases of módulo 11: `r === 11` → check digit "0";
  // `r === 10` → check digit "1". Without these the corresponding branches
  // are unreachable in tests.
  it("returns '0' when 11 - (sum % 11) === 11 (sum divisible by 11)", () => {
    // codigoNumerico=00000005 produces sum%11=0 → r=11 → check "0".
    const base = "190520260117900123440011001001000000123000000051";
    expect(computeClaveAccesoCheckDigit(base)).toBe("0");
    expect(isValidClaveAcceso(`${base}0`)).toBe(true);
  });

  it("returns '1' when 11 - (sum % 11) === 10 (sum % 11 === 1)", () => {
    // codigoNumerico=00000009 produces sum%11=1 → r=10 → check "1".
    const base = "190520260117900123440011001001000000123000000091";
    expect(computeClaveAccesoCheckDigit(base)).toBe("1");
    expect(isValidClaveAcceso(`${base}1`)).toBe(true);
  });
});
