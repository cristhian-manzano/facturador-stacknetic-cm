/**
 * Cross-check between the utils-side generator (canonical) and the
 * contracts-side validator (pure check, zero-dep) — both must agree on the
 * validity of any clave de acceso.
 *
 * The contracts package re-implements the same módulo-11 algorithm so it
 * can validate at every boundary without taking a runtime dep on
 * `@facturador/utils`. This test prevents the two implementations from
 * drifting: if either side changes its constants or its loop direction,
 * 1000 randomly generated claves will catch it.
 *
 * Required by TASKS-0022 §4.1 / SPEC-0022 AC-7.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ClaveAccesoSchema,
  computeClaveAccesoCheckDigit,
  isValidClaveAcceso as contractsIsValid,
} from "@facturador/contracts/primitives";
import {
  buildClaveAcceso,
  computeModulo11,
  isValidClaveAcceso as utilsIsValid,
  type BuildClaveAccesoInput,
} from "./clave-acceso.js";
import { CLAVE_FIXTURES, CLAVE_SPECIAL_CASES } from "./clave-acceso.fixtures.js";

/* -------------------------------------------------------------------------- */
/*                              Static fixtures                               */
/* -------------------------------------------------------------------------- */

describe("contracts / utils — pinned fixtures cross-check", () => {
  it.each([...CLAVE_FIXTURES, ...CLAVE_SPECIAL_CASES].map((f) => [f.name, f] as const))(
    "%s — both validators accept and recompute the same check digit",
    (_name, fx) => {
      // Both validators agree the clave is valid.
      expect(utilsIsValid(fx.expected)).toBe(true);
      expect(contractsIsValid(fx.expected)).toBe(true);

      // Both implementations compute the same check digit for the same base.
      const base = fx.expected.slice(0, 48);
      expect(computeModulo11(base)).toBe(fx.expected.slice(48));
      expect(computeClaveAccesoCheckDigit(base)).toBe(fx.expected.slice(48));

      // And the contracts schema accepts the clave at the boundary.
      expect(() => ClaveAccesoSchema.parse(fx.expected)).not.toThrow();
    },
  );
});

/* -------------------------------------------------------------------------- */
/*                       Property-based cross-validation                      */
/* -------------------------------------------------------------------------- */

const digits = (n: number): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: 10 ** n - 1 }).map((v) => String(v).padStart(n, "0"));

const isoDate = (): fc.Arbitrary<string> =>
  fc.date({ min: new Date(2020, 0, 1), max: new Date(2030, 11, 31) }).map((d) => {
    const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

const inputArb: fc.Arbitrary<BuildClaveAccesoInput> = fc.record({
  fechaEmision: isoDate(),
  codDoc: fc.constantFrom<"01" | "04" | "05" | "06" | "07">("01", "04", "05", "06", "07"),
  ruc: digits(13),
  ambiente: fc.constantFrom<"1" | "2">("1", "2"),
  estab: digits(3),
  ptoEmi: digits(3),
  secuencial: digits(9),
  codigoNumerico: digits(8),
  tipoEmision: fc.constant<"1">("1"),
});

describe("contracts / utils — property-based agreement (100+ samples)", () => {
  it("for 100+ random valid claves, utils and contracts agree on validity AND check digit", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const clave = buildClaveAcceso(input);
        const base = clave.slice(0, 48);
        // 1) Both `isValid` paths agree.
        if (utilsIsValid(clave) !== contractsIsValid(clave)) return false;
        // 2) Both check-digit functions agree.
        if (computeModulo11(base) !== computeClaveAccesoCheckDigit(base)) {
          return false;
        }
        // 3) The Zod schema accepts what `utilsIsValid` accepts.
        if (utilsIsValid(clave) !== ClaveAccesoSchema.safeParse(clave).success) {
          return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("for tampered claves, utils and contracts both reject", () => {
    fc.assert(
      fc.property(inputArb, fc.nat({ max: 48 }), (input, pos) => {
        const clave = buildClaveAcceso(input);
        const original = clave.charAt(pos);
        const replaced = String((Number(original) + 1) % 10);
        if (replaced === original) return true;
        const tampered = clave.slice(0, pos) + replaced + clave.slice(pos + 1);
        // The two implementations must produce the SAME boolean (whether
        // true or false thanks to the SRI r=1↔r=10 collision documented
        // in clave-acceso.test.ts).
        return utilsIsValid(tampered) === contractsIsValid(tampered);
      }),
      { numRuns: 200 },
    );
  });
});
