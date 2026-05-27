/**
 * `InvoiceListItemSchema` and `InvoiceListResponseSchema` — invoice list
 * (cursor-paginated) per SPEC-0043 §6.2 and SPEC-0032 §FR-2.
 *
 * The list view is purposely flat (no joins): just the columns the table
 * needs. Detail-page fetches enrich.
 */
import { z } from "zod";

import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { EstabSchema, PtoEmiSchema, SecuencialSchema } from "../primitives/establecimiento.js";
import { IsoDateSchema } from "../primitives/iso-date.js";
import { MoneySchema } from "../primitives/money.js";
import { UlidSchema } from "../primitives/ulid.js";
import { SriEstadoSchema } from "../sri/document.js";

import { InvoiceEstadoSchema } from "./invoice.js";

export const InvoiceListItemSchema = z.object({
  id: UlidSchema,
  estado: InvoiceEstadoSchema,
  sriEstado: SriEstadoSchema.optional(),
  fechaEmision: IsoDateSchema,
  customerRazonSocial: z.string().min(1).max(300),
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema.optional(),
  claveAcceso: ClaveAccesoSchema.optional(),
  importeTotal: MoneySchema,
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

export const InvoiceListResponseSchema = z.object({
  items: z.array(InvoiceListItemSchema),
  nextCursor: UlidSchema.nullable(),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;
