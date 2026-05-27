/**
 * `SriEstadoSchema` + `SriDocumentSchema` — SRI Core document persistence
 * shape per SPEC-0020 §6.4 and SPEC-0026 (lifecycle).
 *
 * `SriEstadoSchema` unions the lifecycle states observed across our system
 * AND the upstream SRI states; SRI Core normalises both into this single
 * enum. `PENDIENTE` is our pre-build state; `ERROR_BUILD` covers XSD/code
 * failures that never reach the SRI wire.
 */
import { z } from "zod";

import { AmbienteSchema } from "../primitives/ambiente.js";
import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { EstabSchema, PtoEmiSchema, SecuencialSchema } from "../primitives/establecimiento.js";
import { IsoDateSchema } from "../primitives/iso-date.js";
import { UlidSchema } from "../primitives/ulid.js";

export const SriEstadoSchema = z.enum([
  "PENDIENTE",
  "FIRMADO",
  "ENVIADO",
  "RECIBIDA",
  "EN_PROCESO",
  "AUTORIZADO",
  "NO_AUTORIZADO",
  "DEVUELTA",
  "ERROR_RED",
  "ERROR_BUILD",
]);
export type SriEstado = z.infer<typeof SriEstadoSchema>;

export const SriCodDocSchema = z.enum(["01", "04", "05", "06", "07"]);
export type SriCodDoc = z.infer<typeof SriCodDocSchema>;

export const SriDocumentSchema = z.object({
  id: UlidSchema,
  companyId: UlidSchema,
  claveAcceso: ClaveAccesoSchema,
  ambiente: AmbienteSchema,
  codDoc: SriCodDocSchema,
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema,
  fechaEmision: IsoDateSchema,
  estado: SriEstadoSchema,
  numeroAutorizacion: z.string().nullable().optional(),
  fechaAutorizacion: z.string().datetime({ offset: true }).nullable().optional(),
  signedXmlBlobId: z.string().nullable().optional(),
  authorizedXmlBlobId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SriDocument = z.infer<typeof SriDocumentSchema>;
