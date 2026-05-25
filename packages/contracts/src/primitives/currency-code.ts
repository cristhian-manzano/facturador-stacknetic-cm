/**
 * `CurrencyCodeSchema` — ISO-style currency code accepted by SRI.
 *
 * Ecuador's official currency is USD, but SRI expects the literal string
 * `"DOLAR"` in `<moneda>` (ficha técnica §6). For v1 we accept only that
 * value — opening this enum is a deliberate, reviewable change per TASKS
 * §2.9 + PLAN-0005 §3 (the `exports` map is the contract).
 */
import { z } from "zod";

export const CurrencyCodeSchema = z.enum(["DOLAR"]);

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
