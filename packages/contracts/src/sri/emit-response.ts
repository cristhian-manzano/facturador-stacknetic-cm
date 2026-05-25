/**
 * `EmitDocumentResponseSchema` — service-to-service response from SRI Core
 * to API after `POST /v1/documents/emit`.
 *
 * Per SPEC-0005 §6.7 + SPEC-0020. `signedXmlSha256` lets the API audit the
 * exact bytes that were signed without exposing the XML itself (PROMPT
 * §6 forbids logging the XML body anywhere).
 */
import { z } from "zod";
import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { SriEstadoSchema } from "./document.js";
import { SriMensajeSchema } from "./mensaje.js";

export const EmitDocumentResponseSchema = z.object({
  claveAcceso: ClaveAccesoSchema,
  estado: SriEstadoSchema,
  mensajes: z.array(SriMensajeSchema).optional(),
  numeroAutorizacion: z.string().optional(),
  fechaAutorizacion: z.string().datetime({ offset: true }).optional(),
  signedXmlSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "signedXmlSha256 debe ser un hex de 64 chars")
    .optional(),
});

export type EmitDocumentResponse = z.infer<typeof EmitDocumentResponseSchema>;
