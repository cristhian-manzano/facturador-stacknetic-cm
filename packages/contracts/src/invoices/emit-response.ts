/**
 * `EmitInvoiceResponseSchema` — response of `POST /api/v1/invoices/:id/emit`
 * (SPEC-0033 §FR-2).
 *
 * Carries the orchestrator outcome that the UI displays as a status banner.
 * The mensajes array is sanitised by `apps/api` from the SRI raw response
 * before it reaches this shape; we re-export `SriMensajeSchema` to keep
 * sources unique.
 */
import { z } from "zod";
import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { SriEstadoSchema } from "../sri/document.js";
import { SriMensajeSchema } from "../sri/mensaje.js";

export const EmitInvoiceResponseSchema = z.object({
  estado: SriEstadoSchema,
  claveAcceso: ClaveAccesoSchema,
  numeroAutorizacion: z.string().optional(),
  fechaAutorizacion: z.string().datetime({ offset: true }).optional(),
  mensajes: z.array(SriMensajeSchema).optional(),
});

export type EmitInvoiceResponse = z.infer<typeof EmitInvoiceResponseSchema>;
