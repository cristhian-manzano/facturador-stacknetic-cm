/**
 * Consumer smoke test for `@facturador/utils/sri` from `apps/api`.
 *
 * Mirrors `contracts.smoke.test.ts`: proves that the package's `exports`
 * map resolves cleanly via the `./sri` subpath, that the builder produces
 * a 49-digit clave for a well-formed input, that the validator agrees,
 * and that the contracts-side Zod schema accepts the same string (no
 * drift between utils and contracts at the consumer boundary).
 *
 * This is the consumer-side acceptance gate for SPEC-0022 §7.1 / TASKS-0022
 * §5.1. If this test ever fails on `import`, the package contract has
 * drifted and the orchestrator (SPEC-0033) won't link.
 */
import { describe, expect, it } from "vitest";
import {
  BuildClaveAccesoError,
  buildClaveAcceso,
  generateCodigoNumerico,
  isValidClaveAcceso,
} from "@facturador/utils/sri";
import { ClaveAccesoSchema } from "@facturador/contracts/primitives";

describe("@facturador/utils/sri consumer smoke", () => {
  it("buildClaveAcceso produces a 49-digit clave from a known good input", () => {
    const clave = buildClaveAcceso({
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
    expect(/^\d{49}$/.test(clave)).toBe(true);
    expect(clave).toBe("1905202601179001234500110010010000001231234567817");
  });

  it("the produced clave parses cleanly through the contracts Zod schema", () => {
    const clave = buildClaveAcceso({
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
    expect(isValidClaveAcceso(clave)).toBe(true);
    expect(() => ClaveAccesoSchema.parse(clave)).not.toThrow();
  });

  it("auto-generated codigoNumerico still yields a parseable clave", () => {
    const clave = buildClaveAcceso({
      fechaEmision: "2026-05-19",
      codDoc: "01",
      ruc: "1790012345001",
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: 1,
      tipoEmision: "1",
    });
    expect(/^\d{49}$/.test(clave)).toBe(true);
    expect(isValidClaveAcceso(clave)).toBe(true);
  });

  it("rejects malformed inputs with the typed BuildClaveAccesoError", () => {
    expect(() =>
      buildClaveAcceso({
        fechaEmision: "2026-05-19",
        codDoc: "01",
        ruc: "INVALID",
        ambiente: "1",
        estab: "001",
        ptoEmi: "001",
        secuencial: "000000123",
        codigoNumerico: "12345678",
        tipoEmision: "1",
      }),
    ).toThrow(BuildClaveAccesoError);
  });

  it("generateCodigoNumerico exposes the helper to the API layer", () => {
    const cn = generateCodigoNumerico();
    expect(/^\d{8}$/.test(cn)).toBe(true);
  });
});
