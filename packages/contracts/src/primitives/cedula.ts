/**
 * `CedulaSchema` — 10-digit Ecuadorian national ID.
 *
 * Per SPEC-0031 §6.3 and `docs/sri-facturacion-electronica-ecuador.md` §8:
 *
 *   - 10 digits.
 *   - Province code (positions 1–2) is in `01..24`.
 *   - Third digit (the tipo) is `0..5` for natural persons (6..9 reserved).
 *   - Módulo 10 check on the 10th digit: coefficients `[2,1,2,1,2,1,2,1,2]`
 *     applied left-to-right; products ≥ 10 reduced by 9; `(10 - sum % 10) % 10`
 *     equals the 10th digit.
 *
 * Branded to keep validated cédulas separable from raw strings at the type
 * level (TASKS-0005 §2.4).
 */
import { z } from "zod";

const CEDULA_REGEX = /^\d{10}$/;
const COEFS = [2, 1, 2, 1, 2, 1, 2, 1, 2] as const;

export const isValidCedulaChecksum = (value: string): boolean => {
  if (!CEDULA_REGEX.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (province < 1 || province > 24) return false;
  const third = Number(value[2]);
  if (third > 5) return false; // 6..9 are reserved for non-natural persons.

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    // `i < 9` so `value.charAt(i)` is always a digit and `COEFS[i]` exists.
    const coef = COEFS[i] ?? 0;
    let product = Number(value.charAt(i)) * coef;
    if (product >= 10) product -= 9;
    sum += product;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value.charAt(9));
};

export const CedulaSchema = z
  .string()
  .regex(CEDULA_REGEX, "cédula debe tener exactamente 10 dígitos")
  .refine(isValidCedulaChecksum, { message: "cédula con dígito verificador inválido" })
  .brand<"Cedula">();

export type Cedula = z.infer<typeof CedulaSchema>;
