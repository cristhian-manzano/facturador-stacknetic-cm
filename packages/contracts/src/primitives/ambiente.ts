/**
 * `AmbienteSchema` — SRI environment.
 *
 * Two values per the ficha técnica:
 *   - `"1"` pruebas (testing)
 *   - `"2"` producción
 *
 * Never coerce (PLAN-0005 §3 + glossary "Ambiente"). The same field is
 * embedded in `claveAcceso`, so a typo here would silently produce
 * documents the SRI rejects with the most confusing message in the catalog.
 */
import { z } from "zod";

export const AmbienteSchema = z.enum(["1", "2"]);

export type Ambiente = z.infer<typeof AmbienteSchema>;
