/**
 * `EmitDocumentRequestSchema` — service-to-service body sent by `apps/api`
 * to `apps/sri-core` via `POST /v1/documents/emit`.
 *
 * Per SPEC-0005 §6.7 + SPEC-0020 §6.6. SRI Core re-validates the wire
 * payload; the `factura` blob is the validated invoice domain object —
 * shape-checked here but kept loose (`z.record(z.unknown())`) because the
 * full XML-bound shape lives in SPEC-0023 and is intentionally not
 * duplicated. Note: this is the **only** place we use `z.unknown()` and it
 * is justified per PROMPT-0005 §2 (downstream spec defines the inner shape).
 */
import { z } from "zod";
import { AmbienteSchema } from "../primitives/ambiente.js";
import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { FechaEmisionSchema } from "../primitives/fecha-emision.js";
import { EstabSchema, PtoEmiSchema, SecuencialSchema } from "../primitives/establecimiento.js";
import { TipoEmisionSchema } from "../primitives/tipo-emision.js";
import { UlidSchema } from "../primitives/ulid.js";

export const EmitDocumentRequestSchema = z.object({
  companyId: UlidSchema,
  ambiente: AmbienteSchema,
  codDoc: z.literal("01"),
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema,
  claveAcceso: ClaveAccesoSchema,
  fechaEmision: FechaEmisionSchema,
  tipoEmision: TipoEmisionSchema,
  // `factura` is opaque at this contract layer; SPEC-0023 defines the inner
  // structure consumed by the XML builder. We require it to be a non-null
  // object so the type system catches missing-payload mistakes; the runtime
  // shape check happens deeper in SRI Core.
  factura: z.record(z.unknown()),
});

export type EmitDocumentRequest = z.infer<typeof EmitDocumentRequestSchema>;
