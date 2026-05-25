/**
 * `EstabSchema` / `PtoEmiSchema` / `SecuencialSchema` — SRI sequence shape.
 *
 * Per SPEC-0005 §6.3 + the SRI ficha técnica §6:
 *
 *   - `estab` (3 digits, zero-padded) identifies a `establecimiento`.
 *   - `ptoEmi` (3 digits, zero-padded) identifies a `punto de emisión`.
 *   - `secuencial` (9 digits, zero-padded) is the strictly increasing
 *      counter per `(tenant, estab, ptoEmi, codDoc)`.
 *
 * All three are kept as strings — leading zeros are part of the SRI contract
 * and cannot survive a `number` round-trip.
 */
import { z } from "zod";

export const EstabSchema = z
  .string()
  .regex(/^\d{3}$/, "estab debe tener 3 dígitos")
  .brand<"Estab">();
export type Estab = z.infer<typeof EstabSchema>;

export const PtoEmiSchema = z
  .string()
  .regex(/^\d{3}$/, "ptoEmi debe tener 3 dígitos")
  .brand<"PtoEmi">();
export type PtoEmi = z.infer<typeof PtoEmiSchema>;

export const SecuencialSchema = z
  .string()
  .regex(/^\d{9}$/, "secuencial debe tener 9 dígitos")
  .brand<"Secuencial">();
export type Secuencial = z.infer<typeof SecuencialSchema>;
