/**
 * `CreateInvoiceSchema` — `POST /api/v1/invoices` body. Per SPEC-0032 §6.4.
 *
 * The client may either:
 *   - reference an existing customer via `customerId`, OR
 *   - inline-create a customer via `customer` (validated as
 *     `CustomerInputSchema`).
 *
 * Exactly one of those must be present; the cross-field rule is enforced
 * with `.refine`. Server-side recomputes all totals; this contract is
 * about **shape**, not arithmetic (SPEC-0032 §FR-3).
 */
import { z } from "zod";

import { CustomerInputSchema } from "../customers/customer.js";
import { IsoDateSchema } from "../primitives/iso-date.js";
import { MoneyQtySchema, MoneySchema } from "../primitives/money.js";
import { UlidSchema } from "../primitives/ulid.js";

const ImpuestoInputSchema = z.object({
  codigo: z.enum(["2", "3", "5"]),
  codigoPorcentaje: z.string().regex(/^\d{1,4}$/),
  tarifa: z.number().nonnegative(),
});

const CreateInvoiceLineSchema = z.object({
  codigoPrincipal: z.string().min(1).max(25).optional(),
  codigoAuxiliar: z.string().min(1).max(25).optional(),
  descripcion: z.string().min(1).max(300),
  unidadMedida: z.string().min(1).max(50).optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema.default(0),
  impuestos: z.array(ImpuestoInputSchema).min(1),
});

const CreateInvoicePaymentSchema = z.object({
  formaPago: z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]),
  total: MoneySchema,
  plazo: MoneySchema.optional(),
  unidadTiempo: z.string().max(10).optional(),
});

export const CreateInvoiceSchema = z
  .object({
    emissionPointId: UlidSchema,
    customerId: UlidSchema.optional(),
    customer: CustomerInputSchema.optional(),
    fechaEmision: IsoDateSchema,
    lines: z.array(CreateInvoiceLineSchema).min(1).max(500),
    payments: z.array(CreateInvoicePaymentSchema).min(1),
    propina: MoneySchema.optional(),
    totalDescuento: MoneySchema.optional(),
    adicionales: z
      .array(
        z.object({
          nombre: z.string().min(1).max(300),
          valor: z.string().min(1).max(300),
        }),
      )
      .max(15)
      .optional(),
  })
  .refine((value) => value.customerId !== undefined || value.customer !== undefined, {
    message: "customerId or customer is required",
    path: ["customerId"],
  });

export type CreateInvoice = z.infer<typeof CreateInvoiceSchema>;
