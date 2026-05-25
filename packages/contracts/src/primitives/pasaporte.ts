/**
 * `PasaporteSchema` — passport identifier.
 *
 * Per SPEC-0005 §6.3 and SPEC-0031: 1–20 alphanumeric characters. Passport
 * formats vary by issuing country, so we intentionally stay lax (no country
 * prefix, no checksum). Length cap defends against unbounded-string DoS
 * (SPEC-0005 §10).
 *
 * Branded `"Pasaporte"` to keep it separable from RUC/cédula at the type
 * level (TASKS-0005 §2.5).
 */
import { z } from "zod";

const PASAPORTE_REGEX = /^[A-Za-z0-9]{1,20}$/;

export const PasaporteSchema = z
  .string()
  .regex(PASAPORTE_REGEX, "pasaporte debe ser alfanumérico (1–20 caracteres)")
  .brand<"Pasaporte">();

export type Pasaporte = z.infer<typeof PasaporteSchema>;
