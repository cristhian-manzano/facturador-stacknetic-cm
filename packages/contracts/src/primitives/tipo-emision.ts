/**
 * `TipoEmisionSchema` — emission type.
 *
 * Per the ficha técnica (§4 in `docs/sri-facturacion-electronica-ecuador.md`)
 * only `"1"` (normal / offline scheme) is supported. Contingencia (`"2"`) is
 * deprecated and explicitly out of scope (SPEC-0022 FR-1).
 */
import { z } from "zod";

export const TipoEmisionSchema = z.enum(["1"]);

export type TipoEmision = z.infer<typeof TipoEmisionSchema>;
