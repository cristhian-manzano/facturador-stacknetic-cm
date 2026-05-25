/**
 * `ClaveAccesoSchema` — 49-digit SRI access key.
 *
 * The 49th digit is a módulo-11 check over the first 48 (weights `[2..7]`
 * cyclic, right-to-left). This package re-implements the **pure check** so
 * `@facturador/contracts` can validate at every boundary without depending
 * on `@facturador/utils`. The canonical builder still lives in
 * `packages/utils/src/clave-acceso/` per SPEC-0022; this schema only
 * verifies, never generates.
 *
 * Sources:
 *   - `docs/sri-facturacion-electronica-ecuador.md` §4.
 *   - SPEC-0005 §6.4 (reference implementation).
 *   - SPEC-0022 §6.2.
 */
import { z } from "zod";

const CLAVE_REGEX = /^\d{49}$/;
// Weights applied right-to-left, cyclically. Encoded as a function (rather
// than `WEIGHTS[w]!`) to satisfy the no-non-null-assertion rule without
// introducing an unreachable `?? 0` branch.
const claveWeight = (cycle: number): number => {
  const WEIGHTS = [2, 3, 4, 5, 6, 7];
  return WEIGHTS[cycle] ?? 0;
};
const WEIGHT_COUNT = 6;

export const computeClaveAccesoCheckDigit = (base48: string): string => {
  let sum = 0;
  let w = 0;
  for (let i = base48.length - 1; i >= 0; i--) {
    sum += Number(base48.charAt(i)) * claveWeight(w);
    w = (w + 1) % WEIGHT_COUNT;
  }
  const r = 11 - (sum % 11);
  if (r === 11) return "0";
  if (r === 10) return "1";
  return String(r);
};

export const isValidClaveAcceso = (value: string): boolean => {
  if (!CLAVE_REGEX.test(value)) return false;
  const base = value.slice(0, 48);
  const verifier = value.slice(48);
  return computeClaveAccesoCheckDigit(base) === verifier;
};

export const ClaveAccesoSchema = z
  .string()
  .regex(CLAVE_REGEX, "claveAcceso debe tener exactamente 49 dígitos")
  .refine(isValidClaveAcceso, {
    message: "claveAcceso con dígito verificador inválido",
  })
  .brand<"ClaveAcceso">();

export type ClaveAcceso = z.infer<typeof ClaveAccesoSchema>;
