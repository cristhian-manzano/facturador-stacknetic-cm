/**
 * `UpdateInvoiceSchema` — `PATCH /api/v1/invoices/:id` (BORRADOR only).
 *
 * Per SPEC-0032 §FR-8: edits are allowed only while estado=BORRADOR. The
 * schema accepts the same line/payment shape as create, but every top-level
 * field is optional so the client can do partial updates.
 *
 * We do **not** allow changing `emissionPointId` here — a different
 * emission point implies a different secuencial reservation, which has to
 * happen at emit time, not at draft edit.
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

const LineSchema = z.object({
  codigoPrincipal: z.string().min(1).max(25).optional(),
  codigoAuxiliar: z.string().min(1).max(25).optional(),
  descripcion: z.string().min(1).max(300),
  unidadMedida: z.string().min(1).max(50).optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema.default(0),
  impuestos: z.array(ImpuestoInputSchema).min(1),
});

const PaymentSchema = z.object({
  formaPago: z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]),
  total: MoneySchema,
  plazo: MoneySchema.optional(),
  unidadTiempo: z.string().max(10).optional(),
});

export const UpdateInvoiceSchema = z
  .object({
    customerId: UlidSchema.optional(),
    customer: CustomerInputSchema.optional(),
    fechaEmision: IsoDateSchema.optional(),
    lines: z.array(LineSchema).min(1).max(500).optional(),
    payments: z.array(PaymentSchema).min(1).optional(),
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
  .refine((value) => Object.keys(value).length > 0, {
    message: "update payload must contain at least one field",
  });

export type UpdateInvoice = z.infer<typeof UpdateInvoiceSchema>;
