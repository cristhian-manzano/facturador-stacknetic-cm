/**
 * Preview-totals contract — used by the create/edit form to recompute totals
 * without persisting (SPEC-0032 §FR-2 + §6.1, SPEC-0042 §6.4).
 *
 * Request mirrors `CreateInvoice` but the server response carries the
 * computed totals back to the UI.
 */
import { z } from "zod";

import { MoneySchema } from "../primitives/money.js";

import { CreateInvoiceSchema } from "./create-invoice.js";
import { InvoiceImpuestoSchema } from "./invoice.js";

export const PreviewTotalsRequestSchema = CreateInvoiceSchema;
export type PreviewTotalsRequest = z.infer<typeof PreviewTotalsRequestSchema>;

const PreviewLineSchema = z.object({
  precioTotalSinImpuesto: MoneySchema,
  impuestos: z.array(InvoiceImpuestoSchema),
});

export const PreviewTotalsResponseSchema = z.object({
  lines: z.array(PreviewLineSchema),
  totalSinImpuestos: MoneySchema,
  totalDescuento: MoneySchema,
  totalConImpuestos: z.array(InvoiceImpuestoSchema),
  propina: MoneySchema,
  importeTotal: MoneySchema,
});
export type PreviewTotalsResponse = z.infer<typeof PreviewTotalsResponseSchema>;
