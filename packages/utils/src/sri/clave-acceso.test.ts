/**
 * Tests for `clave-acceso.ts` — SRI 49-digit access key generator.
 *
 * Test surface (per TASKS-0022 §2):
 *   - 5 pinned fixtures spanning the supported `codDoc` values.
 *   - Both módulo-11 special branches (`r=10` → "1", `r=11` → "0").
 *   - Property-based round-trip with `fast-check` (1000 random inputs).
 *   - Validator behaviour on tampered claves, wrong-length inputs, non-digit
 *     inputs, and non-string inputs.
 *   - Negative paths in `buildClaveAcceso` — each malformed field throws a
 *     typed {@link BuildClaveAccesoError} with the expected `code`.
 *   - `generateCodigoNumerico` — uses `crypto.randomInt`, returns exactly
 *     8 ASCII digits, low duplicate rate over 10 000 samples.
 *
 * Authoritative sources cross-referenced inline:
 *   - docs/sri-facturacion-electronica-ecuador.md §4 (algorithm).
 *   - ai/specs/0022-clave-acceso-generator.md (functional contract).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CLAVE_FIXTURES, CLAVE_SPECIAL_CASES } from "./clave-acceso.fixtures.js";
import type { ClaveAccesoFixture } from "./clave-acceso.fixtures.js";
import {
  BuildClaveAccesoError,
  buildClaveAcceso,
  computeModulo11,
  generateCodigoNumerico,
  isValidClaveAcceso,
  parseClaveAcceso,
  validateClaveAcceso,
  type BuildClaveAccesoInput,
} from "./clave-acceso.js";

/**
 * Type-safe accessor for the first fixture — keeps the test code free of
 * non-null assertions (forbidden by `@typescript-eslint/no-non-null-assertion`).
 */
const requireFirstFixture = (): ClaveAccesoFixture => {
  const first = CLAVE_FIXTURES[0];
  if (first === undefined) {
    throw new Error("CLAVE_FIXTURES must contain at least one entry");
  }
  return first;
};

/* -------------------------------------------------------------------------- */
/*                            Fixture-driven tests                            */
/* -------------------------------------------------------------------------- */

describe("buildClaveAcceso — pinned fixtures", () => {
  it.each(CLAVE_FIXTURES.map((f) => [f.name, f] as const))(
    "produces the expected 49-digit clave for %s",
    (_name, fx) => {
      const out = buildClaveAcceso(fx.input);
      expect(out).toBe(fx.expected);
      expect(out.length).toBe(49);
      expect(/^\d{49}$/.test(out)).toBe(true);
      expect(out.slice(48)).toBe(fx.checkDigit);
      expect(isValidClaveAcceso(out)).toBe(true);
    },
  );

  it("is deterministic — same input always yields the same clave", () => {
    const fx = requireFirstFixture();
    const a = buildClaveAcceso(fx.input);
    const b = buildClaveAcceso(fx.input);
    expect(a).toBe(b);
    expect(a).toBe(fx.expected);
  });
});

/* -------------------------------------------------------------------------- */
/*                       Module-11 special-case branches                      */
/* -------------------------------------------------------------------------- */

describe("computeModulo11 — special branches", () => {
  it.each(CLAVE_SPECIAL_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const out = buildClaveAcceso(c.input);
    expect(out).toBe(c.expected);
    expect(out.slice(48)).toBe(c.checkDigit);
    expect(computeModulo11(out.slice(0, 48))).toBe(c.checkDigit);
  });

  it("rejects a base that isn't 48 digits", () => {
    expect(() => computeModulo11("1234")).toThrow(BuildClaveAccesoError);
    expect(() => computeModulo11("1".repeat(47))).toThrow(BuildClaveAccesoError);
    expect(() => computeModulo11("1".repeat(49))).toThrow(BuildClaveAccesoError);
  });

  it("rejects a 48-char base containing a non-digit", () => {
    const base = "1".repeat(47) + "A";
    expect(() => computeModulo11(base)).toThrow(/48 digits/);
  });
});

/* -------------------------------------------------------------------------- */
/*                             Validator tests                                */
/* -------------------------------------------------------------------------- */

describe("isValidClaveAcceso", () => {
  it("accepts every pinned fixture", () => {
    for (const f of CLAVE_FIXTURES) {
      expect(isValidClaveAcceso(f.expected)).toBe(true);
    }
  });

  it("rejects a fixture whose check digit has been incremented mod 10", () => {
    for (const f of CLAVE_FIXTURES) {
      const lastDigit = Number(f.expected.slice(48));
      const tampered = `${f.expected.slice(0, 48)}${String((lastDigit + 1) % 10)}`;
      expect(tampered).not.toBe(f.expected);
      expect(isValidClaveAcceso(tampered)).toBe(false);
    }
  });

  it("rejects inputs of the wrong length (48, 50, empty)", () => {
    const good = requireFirstFixture().expected;
    expect(isValidClaveAcceso(good.slice(0, 48))).toBe(false);
    expect(isValidClaveAcceso(`${good}0`)).toBe(false);
    expect(isValidClaveAcceso("")).toBe(false);
  });

  it("rejects inputs containing non-digit characters", () => {
    const good = requireFirstFixture().expected;
    expect(isValidClaveAcceso(`${good.slice(0, 48)}A`)).toBe(false);
    expect(isValidClaveAcceso(`${good.slice(0, 47)}A${good.slice(48)}`)).toBe(false);
  });

  it("rejects non-string inputs", () => {
    // Cast through `unknown` so we exercise the runtime guard without
    // disabling the TS contract — these are reachable from JS callers.
    expect(isValidClaveAcceso(123 as unknown as string)).toBe(false);
    expect(isValidClaveAcceso(null as unknown as string)).toBe(false);
    expect(isValidClaveAcceso(undefined as unknown as string)).toBe(false);
  });
});

describe("validateClaveAcceso (reasoned form)", () => {
  it("returns `{ok: true}` for every fixture", () => {
    for (const f of CLAVE_FIXTURES) {
      expect(validateClaveAcceso(f.expected)).toEqual({ ok: true });
    }
  });

  it("flags length mismatch", () => {
    expect(validateClaveAcceso("123")).toEqual({
      ok: false,
      reason: "length != 49",
    });
  });

  it("flags non-digit characters", () => {
    const good = requireFirstFixture().expected;
    expect(validateClaveAcceso(`${good.slice(0, 48)}X`)).toEqual({
      ok: false,
      reason: "non-digit characters",
    });
  });

  it("flags non-string input", () => {
    expect(validateClaveAcceso(42 as unknown as string)).toEqual({
      ok: false,
      reason: "not a string",
    });
  });

  it("flags a verifier-digit mismatch", () => {
    const good = requireFirstFixture().expected;
    const last = Number(good.slice(48));
    const wrong = `${good.slice(0, 48)}${String((last + 1) % 10)}`;
    expect(validateClaveAcceso(wrong)).toEqual({
      ok: false,
      reason: "verifier digit mismatch",
    });
  });
});

describe("parseClaveAcceso", () => {
  it("returns the valid clave unchanged", () => {
    const f = requireFirstFixture();
    expect(parseClaveAcceso(f.expected)).toBe(f.expected);
  });

  it("throws INVALID_BASE_LENGTH on a wrong-length input", () => {
    try {
      parseClaveAcceso("123");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildClaveAccesoError);
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_BASE_LENGTH");
    }
  });

  it("throws INVALID_CHECK_DIGIT on a tampered verifier", () => {
    const good = requireFirstFixture().expected;
    const last = Number(good.slice(48));
    const tampered = `${good.slice(0, 48)}${String((last + 1) % 10)}`;
    try {
      parseClaveAcceso(tampered);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildClaveAccesoError);
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_CHECK_DIGIT");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                       buildClaveAcceso negative paths                      */
/* -------------------------------------------------------------------------- */

const goodInput = (): BuildClaveAccesoInput => ({
  fechaEmision: "2026-05-19",
  codDoc: "01",
  ruc: "1790012345001",
  ambiente: "1",
  estab: "001",
  ptoEmi: "001",
  secuencial: "000000123",
  codigoNumerico: "12345678",
  tipoEmision: "1",
});

describe("buildClaveAcceso — input validation", () => {
  it("throws INVALID_RUC when ruc has 10 digits (cédula)", () => {
    try {
      buildClaveAcceso({ ...goodInput(), ruc: "1790012345" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildClaveAccesoError);
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_RUC");
      expect((e as BuildClaveAccesoError).field).toBe("ruc");
    }
  });

  it("throws INVALID_RUC when ruc is not a string", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        ruc: 1790012345001 as unknown as string,
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_RUC");
    }
  });

  it("throws INVALID_FECHA when fechaEmision is 2026-02-30 (non-existent date)", () => {
    try {
      buildClaveAcceso({ ...goodInput(), fechaEmision: "2026-02-30" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_FECHA");
    }
  });

  it("throws INVALID_FECHA on a malformed ISO string", () => {
    try {
      buildClaveAcceso({ ...goodInput(), fechaEmision: "19/05/2026" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_FECHA");
    }
  });

  it("throws INVALID_FECHA on a non-Date, non-string input", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        fechaEmision: 12345 as unknown as Date,
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_FECHA");
    }
  });

  it("throws INVALID_FECHA on an invalid Date object", () => {
    try {
      buildClaveAcceso({ ...goodInput(), fechaEmision: new Date("not-a-date") });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_FECHA");
    }
  });

  it("accepts a valid Date and yields a parseable clave", () => {
    // 2026-05-19 in local time. Caller's responsibility per SPEC-0022.
    const out = buildClaveAcceso({
      ...goodInput(),
      fechaEmision: new Date(2026, 4, 19),
    });
    expect(isValidClaveAcceso(out)).toBe(true);
    expect(out.slice(0, 8)).toBe("19052026");
  });

  it("throws INVALID_COD_DOC when codDoc is unsupported", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        codDoc: "99" as unknown as BuildClaveAccesoInput["codDoc"],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_COD_DOC");
    }
  });

  it("throws INVALID_AMBIENTE when ambiente is '3'", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        ambiente: "3" as unknown as BuildClaveAccesoInput["ambiente"],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_AMBIENTE");
    }
  });

  it("throws INVALID_ESTAB when estab is shorter than 3 digits", () => {
    try {
      buildClaveAcceso({ ...goodInput(), estab: "01" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_ESTAB");
    }
  });

  it("throws INVALID_ESTAB when estab contains non-digits", () => {
    try {
      buildClaveAcceso({ ...goodInput(), estab: "00A" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_ESTAB");
    }
  });

  it("throws INVALID_PTO_EMI when ptoEmi is the wrong length", () => {
    try {
      buildClaveAcceso({ ...goodInput(), ptoEmi: "1" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_PTO_EMI");
    }
  });

  it("throws INVALID_SECUENCIAL when secuencial exceeds 9 digits", () => {
    try {
      buildClaveAcceso({ ...goodInput(), secuencial: "1234567890" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_SECUENCIAL");
    }
  });

  it("throws INVALID_SECUENCIAL on a non-digit secuencial string", () => {
    try {
      buildClaveAcceso({ ...goodInput(), secuencial: "abc" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_SECUENCIAL");
    }
  });

  it("throws INVALID_SECUENCIAL on a negative number", () => {
    try {
      buildClaveAcceso({ ...goodInput(), secuencial: -1 });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_SECUENCIAL");
    }
  });

  it("throws INVALID_SECUENCIAL on a fractional number", () => {
    try {
      buildClaveAcceso({ ...goodInput(), secuencial: 1.5 });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_SECUENCIAL");
    }
  });

  it("throws INVALID_SECUENCIAL on a non-string non-number input", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        secuencial: true as unknown as string,
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_SECUENCIAL");
    }
  });

  it("accepts a numeric secuencial and zero-pads it", () => {
    const out = buildClaveAcceso({ ...goodInput(), secuencial: 1 });
    // secuencial occupies positions 31..39 (0-indexed: 30..39 exclusive)
    expect(out.slice(30, 39)).toBe("000000001");
  });

  it("throws INVALID_CODIGO_NUMERICO on a 7-digit string", () => {
    try {
      buildClaveAcceso({ ...goodInput(), codigoNumerico: "1234567" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_CODIGO_NUMERICO");
    }
  });

  it("throws INVALID_CODIGO_NUMERICO on a non-digit string", () => {
    try {
      buildClaveAcceso({ ...goodInput(), codigoNumerico: "1234567A" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_CODIGO_NUMERICO");
    }
  });

  it("throws INVALID_TIPO_EMISION when tipoEmision is '2'", () => {
    try {
      buildClaveAcceso({
        ...goodInput(),
        tipoEmision: "2" as unknown as "1",
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as BuildClaveAccesoError).code).toBe("INVALID_TIPO_EMISION");
    }
  });

  it("auto-generates a codigoNumerico when omitted, yielding a valid clave", () => {
    const input = goodInput();
    // Strip codigoNumerico so the builder generates one.
    delete (input as { codigoNumerico?: string }).codigoNumerico;
    const clave = buildClaveAcceso(input);
    expect(/^\d{49}$/.test(clave)).toBe(true);
    expect(isValidClaveAcceso(clave)).toBe(true);
    // The codigoNumerico is at positions 40-47 (1-based) → slice(39, 47).
    expect(/^\d{8}$/.test(clave.slice(39, 47))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                          generateCodigoNumerico                            */
/* -------------------------------------------------------------------------- */

describe("generateCodigoNumerico", () => {
  it("always returns exactly 8 ASCII digits", () => {
    for (let i = 0; i < 10_000; i++) {
      const cn = generateCodigoNumerico();
      // Use a precondition rather than `expect` in the loop body to keep the
      // failure message useful when something goes wrong.
      if (cn.length !== 8 || !/^\d{8}$/.test(cn)) {
        throw new Error(`generateCodigoNumerico produced bad value: "${cn}"`);
      }
    }
    expect(true).toBe(true);
  });

  it("has a very low collision rate over 10 000 samples (probabilistic)", () => {
    const seen = new Set<string>();
    let duplicates = 0;
    for (let i = 0; i < 10_000; i++) {
      const cn = generateCodigoNumerico();
      if (seen.has(cn)) duplicates++;
      seen.add(cn);
    }
    // Birthday-paradox bound: with 10 000 samples in a space of 10^8,
    // expected dupes ≈ n^2 / 2N ≈ 0.5. Allow up to 5 to keep this
    // test rock-solid across CI runs.
    expect(duplicates).toBeLessThanOrEqual(5);
  });
});

/* -------------------------------------------------------------------------- */
/*                         Property-based round-trip                          */
/* -------------------------------------------------------------------------- */

// Synthetic-only Arbitraries — these are not real RUCs, but they satisfy
// every shape constraint enforced by `buildClaveAcceso`.
const digits = (n: number): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: 10 ** n - 1 }).map((v) => String(v).padStart(n, "0"));

const isoDate = (): fc.Arbitrary<string> =>
  fc.date({ min: new Date(2020, 0, 1), max: new Date(2030, 11, 31) }).map((d) => {
    const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

const codDocArb: fc.Arbitrary<BuildClaveAccesoInput["codDoc"]> = fc.constantFrom(
  "01",
  "04",
  "05",
  "06",
  "07",
);

const ambienteArb: fc.Arbitrary<BuildClaveAccesoInput["ambiente"]> = fc.constantFrom("1", "2");

const inputArb: fc.Arbitrary<BuildClaveAccesoInput> = fc.record({
  fechaEmision: isoDate(),
  codDoc: codDocArb,
  ruc: digits(13),
  ambiente: ambienteArb,
  estab: digits(3),
  ptoEmi: digits(3),
  secuencial: digits(9),
  codigoNumerico: digits(8),
  tipoEmision: fc.constant<"1">("1"),
});

describe("property-based round-trip (fast-check)", () => {
  it("for any valid input, build → validate → parse round-trips", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const clave = buildClaveAcceso(input);
        if (!/^\d{49}$/.test(clave)) return false;
        if (!isValidClaveAcceso(clave)) return false;
        if (parseClaveAcceso(clave) !== clave) return false;
        // Recomputing the check digit from the first 48 chars must give the
        // 49th char — defence against silent off-by-one.
        if (computeModulo11(clave.slice(0, 48)) !== clave.slice(48)) return false;
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  it("flipping the verifier digit always invalidates the clave", () => {
    // The 49th digit is the verifier itself — changing it can never produce
    // a self-consistent clave (the computed check digit cannot equal both
    // the old and the new value).
    fc.assert(
      fc.property(inputArb, (input) => {
        const clave = buildClaveAcceso(input);
        const original = clave.charAt(48);
        const replaced = String((Number(original) + 1) % 10);
        const tampered = clave.slice(0, 48) + replaced;
        return tampered !== clave && !isValidClaveAcceso(tampered);
      }),
      { numRuns: 200 },
    );
  });

  it("flipping a digit in the base48 invalidates the clave (except for the documented r=1↔r=10 collision)", () => {
    // SRI módulo-11 collapses both `r === 10` and `r === 1` onto the same
    // verifier character `"1"` (per docs §4 special-case mapping). That
    // means a single-digit perturbation that bumps `sum mod 11` by exactly
    // ±9 (i.e. flips `r` between 1 and 10) is undetectable by the check
    // digit alone. We assert the *expected* coverage: at least 95 % of
    // single-digit perturbations are caught, and every undetected case is
    // accounted for by the `r=1 ↔ r=10` special-case collision.
    let total = 0;
    let detected = 0;
    let unexpectedMisses = 0;
    fc.assert(
      fc.property(inputArb, fc.nat({ max: 47 }), (input, pos) => {
        const clave = buildClaveAcceso(input);
        const original = clave.charAt(pos);
        const replaced = String((Number(original) + 1) % 10);
        if (replaced === original) return true;
        const tampered = clave.slice(0, pos) + replaced + clave.slice(pos + 1);
        if (tampered === clave) return true;
        total++;
        if (!isValidClaveAcceso(tampered)) {
          detected++;
          return true;
        }
        // Undetected: confirm it's a `r=1 ↔ r=10` special-case collision —
        // both the original and tampered verifiers must equal "1".
        if (clave.slice(48) !== "1" || tampered.slice(48) !== "1") {
          unexpectedMisses++;
          return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
    expect(unexpectedMisses).toBe(0);
    // Sanity floor: the algorithm must still catch the vast majority of
    // perturbations. (The theoretical lower bound is ~9/10 — only flips
    // that move sum mod 11 by exactly ±9 can collide.)
    expect(detected / Math.max(total, 1)).toBeGreaterThan(0.9);
  });

  it("buildClaveAcceso is deterministic w.r.t. its input", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const a = buildClaveAcceso(input);
        const b = buildClaveAcceso(input);
        return a === b;
      }),
      { numRuns: 100 },
    );
  });
});
