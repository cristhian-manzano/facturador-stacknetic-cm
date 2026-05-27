/**
 * `InvoiceDetailSchema` — aggregate response for `GET /api/v1/invoices/:id`
 * (SPEC-0043 §6.2 + SPEC-0032 §FR-2).
 *
 * Joins the invoice with its customer summary and (if present) the linked
 * SRI document and ordered event timeline.
 */
import { z } from "zod";

import { CustomerSchema } from "../customers/customer.js";
import { SriDocumentSchema } from "../sri/document.js";
import { SriEventSchema } from "../sri/event.js";

import { InvoiceSchema } from "./invoice.js";

export const InvoiceDetailSchema = z.object({
  invoice: InvoiceSchema,
  customer: CustomerSchema,
  sriDocument: SriDocumentSchema.nullable(),
  sriEvents: z.array(SriEventSchema),
});

export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;
