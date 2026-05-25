/**
 * `mapProblemErrorsToForm` tests.
 *
 * Drives a fake `setError` to assert the mapping rules — no React Hook
 * Form runtime required.
 */
import { describe, expect, it, vi } from "vitest";
import type { SriMensaje } from "@facturador/contracts/sri";

import { mapProblemErrorsToForm } from "./form-errors.js";

function makeSetError() {
  return vi.fn();
}

describe("mapProblemErrorsToForm", () => {
  it("returns 0 on undefined / empty input", () => {
    const setError = makeSetError();
    expect(mapProblemErrorsToForm(setError, undefined)).toBe(0);
    expect(mapProblemErrorsToForm(setError, [])).toBe(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it("maps identifier → field directly when no fieldMap is supplied", () => {
    const setError = makeSetError();
    const errors: SriMensaje[] = [{ identificador: "email", mensaje: "requerido", tipo: "ERROR" }];
    expect(mapProblemErrorsToForm(setError, errors)).toBe(1);
    expect(setError).toHaveBeenCalledWith("email", {
      type: "server",
      message: "requerido",
    });
  });

  it("translates identifiers via fieldMap when supplied", () => {
    const setError = makeSetError();
    const errors: SriMensaje[] = [{ identificador: "correo", mensaje: "no válido", tipo: "ERROR" }];
    mapProblemErrorsToForm(setError, errors, {
      fieldMap: { correo: "email" },
    });
    expect(setError).toHaveBeenCalledWith("email", {
      type: "server",
      message: "no válido",
    });
  });

  it("skips non-ERROR rows by default", () => {
    const setError = makeSetError();
    const errors: SriMensaje[] = [
      { identificador: "x", mensaje: "warn!", tipo: "ADVERTENCIA" },
      { identificador: "y", mensaje: "info", tipo: "INFORMATIVO" },
      { identificador: "z", mensaje: "fatal", tipo: "ERROR" },
    ];
    expect(mapProblemErrorsToForm(setError, errors)).toBe(1);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("z", expect.anything());
  });

  it("includes warnings when includeWarnings=true", () => {
    const setError = makeSetError();
    const errors: SriMensaje[] = [
      { identificador: "x", mensaje: "warn!", tipo: "ADVERTENCIA" },
      { identificador: "z", mensaje: "fatal", tipo: "ERROR" },
    ];
    expect(mapProblemErrorsToForm(setError, errors, { includeWarnings: true })).toBe(2);
  });
});
