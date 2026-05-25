/**
 * `SriMensajeSchema` — single message returned by SRI (or normalised by
 * SRI Core) for recepción/autorización stages.
 *
 * Defined here so both the SRI emit/status responses and the
 * `ProblemDetail.errors[]` shape can reuse it (PROMPT-0005 §6).
 *
 * Source: ficha técnica §14 (mensajes y manejo de errores) + SPEC-0005
 * §6.7 (envelope) + SPEC-0020 §6.7 (mapper).
 */
import { z } from "zod";

export const SriMensajeTipoSchema = z.enum(["ERROR", "ADVERTENCIA", "INFORMATIVO"]);
export type SriMensajeTipo = z.infer<typeof SriMensajeTipoSchema>;

export const SriMensajeSchema = z.object({
  identificador: z.string().min(1).max(20),
  mensaje: z.string().min(1).max(1000),
  tipo: SriMensajeTipoSchema,
  informacionAdicional: z.string().max(2000).optional(),
});

export type SriMensaje = z.infer<typeof SriMensajeSchema>;
