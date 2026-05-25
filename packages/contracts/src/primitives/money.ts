/**
 * Monetary value primitives.
 *
 * Per SPEC-0005 §6.3 and PLAN-0005 §3:
 *
 *   - `MoneySchema` (a.k.a. money / total): 2-decimal precision, non-negative,
 *     used for `precioTotalSinImpuesto`, `importeTotal`, payment `total`, etc.
 *     We use `.multipleOf(0.01)` to enforce the SRI 2-decimal contract at the
 *     boundary; downstream arithmetic still runs through `decimal.js` per
 *     SPEC-0032 §6.2. This package never computes — only validates.
 *
 *   - `MoneyQtySchema`: 6-decimal precision, non-negative, used for line-level
 *     `cantidad` and `precioUnitario` (SRI ficha técnica §8 quantity pattern
 *     `^\d{1,14}(\.\d{1,6})?$`).
 */
import { z } from "zod";

export const MoneySchema = z
  .number()
  .nonnegative("monto no puede ser negativo")
  .multipleOf(0.01, "monto debe tener máximo 2 decimales");

export type Money = z.infer<typeof MoneySchema>;

export const MoneyQtySchema = z
  .number()
  .nonnegative("cantidad no puede ser negativa")
  .multipleOf(0.000_001, "cantidad debe tener máximo 6 decimales");

export type MoneyQty = z.infer<typeof MoneyQtySchema>;
