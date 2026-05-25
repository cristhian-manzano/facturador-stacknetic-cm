/**
 * `TipoIdentificacionSchema` — SRI catálogo of buyer identification type.
 *
 * Codes per the ficha técnica §9 (mirrored in `glossary.md`):
 *
 *   - `"04"` RUC
 *   - `"05"` Cédula
 *   - `"06"` Pasaporte
 *   - `"07"` Consumidor final (paired with `9999999999999`)
 *   - `"08"` Identificación del exterior
 *
 * This enum is the discriminator key for the customer union (SPEC-0031 §FR-3
 * + TASKS §5.1).
 */
import { z } from "zod";

export const TipoIdentificacionSchema = z.enum(["04", "05", "06", "07", "08"]);

export type TipoIdentificacion = z.infer<typeof TipoIdentificacionSchema>;
