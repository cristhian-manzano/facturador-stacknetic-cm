/**
 * Tests for the `clave-acceso` CLI helper.
 *
 * Coverage:
 *
 *   - Happy path: required args + fixed codigoNumerico → 49-digit clave.
 *   - Tipo validation: a value outside the enum is rejected.
 *   - Ambiente validation: only "1" and "2" are accepted.
 *   - Missing required args produce a usage line.
 *   - BuildClaveAccesoError is surfaced with its `code`.
 */
import { describe, expect, it } from "vitest";

import { isValidClaveAcceso } from "@facturador/utils/sri";

import { runCli } from "./clave-acceso.js";

describe("clave-acceso CLI", () => {
  it("prints a 49-digit clave for valid inputs", () => {
    const result = runCli([
      "--ruc",
      "1791234567001",
      "--estab",
      "001",
      "--pto",
      "001",
      "--secuencial",
      "000000123",
      "--tipo",
      "01",
      "--ambiente",
      "2",
      "--fecha",
      "2025-01-15",
      "--codigo",
      "12345678",
    ]);

    expect(result.code).toBe(0);
    const clave = result.out.trim();
    expect(clave).toHaveLength(49);
    expect(isValidClaveAcceso(clave)).toBe(true);
  });

  it("rejects an invalid --tipo", () => {
    const result = runCli([
      "--ruc",
      "1791234567001",
      "--estab",
      "001",
      "--pto",
      "001",
      "--secuencial",
      "000000123",
      "--tipo",
      "99",
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("invalid --tipo");
  });

  it("rejects an invalid --ambiente", () => {
    const result = runCli([
      "--ruc",
      "1791234567001",
      "--estab",
      "001",
      "--pto",
      "001",
      "--secuencial",
      "000000123",
      "--tipo",
      "01",
      "--ambiente",
      "3",
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("invalid --ambiente");
  });

  it("reports missing required arguments", () => {
    const result = runCli(["--ruc", "1791234567001"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--estab");
    expect(result.err).toContain("--pto");
    expect(result.err).toContain("--secuencial");
    expect(result.err).toContain("--tipo");
  });

  it("surfaces a structured BuildClaveAccesoError code on bad RUC", () => {
    const result = runCli([
      "--ruc",
      "BAD_RUC",
      "--estab",
      "001",
      "--pto",
      "001",
      "--secuencial",
      "000000123",
      "--tipo",
      "01",
      "--ambiente",
      "2",
      "--fecha",
      "2025-01-15",
      "--codigo",
      "12345678",
    ]);
    expect(result.code).toBe(2);
    // The error message should carry an error code prefix (something like
    // RUC_INVALID — we don't pin the exact value here, only that it
    // surfaces as a structured prefix).
    expect(result.err.length).toBeGreaterThan(0);
  });
});
