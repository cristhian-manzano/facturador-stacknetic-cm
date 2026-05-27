/**
 * `RucSchema` — Ecuadorian RUC (Registro Único de Contribuyentes).
 *
 * 13 digits. Two valid families per SPEC-0031 §6.3:
 *
 *   - **Sociedad / pública**: third digit `6` (sociedad pública) or `9`
 *     (sociedad privada); ends in `001`; módulo 11 check with coefficients
 *     `[4,3,2,7,6,5,4,3,2]` on the first 9 digits.
 *   - **Persona natural**: third digit `0..5`; ends in `00[1-9]` (suffix
 *     per establecimiento); the first 10 digits MUST be a valid cédula
 *     (módulo 10).
 *
 * Branded `"Ruc"` so a plain string can't be passed where the API expects a
 * validated RUC (TASKS-0005 §2.3).
 *
 * Sources:
 *   - `docs/sri-facturacion-electronica-ecuador.md` §8.
 *   - SPEC-0005 §6.3.
 *   - SPEC-0031 §6.3.
 */
import { z } from "zod";

import { isValidCedulaChecksum } from "./cedula.js";

const RUC_REGEX = /^\d{13}$/;
// SRI módulo-11 coefficients for sociedades over digits 0..8. Encoded as a
// function so TypeScript never hands us a possibly-undefined element (we
// can't use a non-null assertion under our lint config).
const sociedadCoef = (index: number): number => {
  const COEFS = [4, 3, 2, 7, 6, 5, 4, 3, 2];
  return COEFS[index] ?? 0;
};

const computeSociedadCheck = (first9: string): number => {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(first9.charAt(i)) * sociedadCoef(i);
  }
  const r = 11 - (sum % 11);
  if (r === 11) return 0;
  if (r === 10) return 1;
  return r;
};

export const isValidRucSociedad = (value: string): boolean => {
  if (!RUC_REGEX.test(value)) return false;
  // Sociedades: third digit must be 6 (pública) or 9 (privada).
  const third = Number(value.charAt(2));
  if (third !== 6 && third !== 9) return false;
  if (value.slice(10) !== "001") return false;
  return computeSociedadCheck(value.slice(0, 9)) === Number(value.charAt(9));
};

export const isValidRucPersonaNatural = (value: string): boolean => {
  if (!RUC_REGEX.test(value)) return false;
  // Establecimiento suffix 001..009.
  if (!/^00[1-9]$/.test(value.slice(10))) return false;
  return isValidCedulaChecksum(value.slice(0, 10));
};

export const isValidRuc = (value: string): boolean =>
  isValidRucSociedad(value) || isValidRucPersonaNatural(value);

export const RucSchema = z
  .string()
  .regex(RUC_REGEX, "RUC debe tener exactamente 13 dígitos")
  .refine(isValidRuc, { message: "RUC con dígito verificador inválido" })
  .brand<"Ruc">();

export type Ruc = z.infer<typeof RucSchema>;
