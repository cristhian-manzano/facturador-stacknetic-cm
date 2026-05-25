/**
 * Invoice schemas — header + line + payment + adicional shapes.
 *
 * Refs: SPEC-0032 (domain model), SPEC-0033 (orchestrator), SPEC-0023
 * (XML builder consumes these via translation). This package defines
 * **shapes only** — arithmetic, taxes, and tolerance checks live in
 * `apps/api` (`compute-totals.ts`).
 *
 * Field names use the SRI Spanish vocabulary verbatim per `ai/context/
 * glossary.md` and the project hard rule.
 */
import { z } from "zod";
import { CurrencyCodeSchema } from "../primitives/currency-code.js";
import { IsoDateSchema } from "../primitives/iso-date.js";
import { MoneyQtySchema, MoneySchema } from "../primitives/money.js";
import { EstabSchema, PtoEmiSchema, SecuencialSchema } from "../primitives/establecimiento.js";
import { ClaveAccesoSchema } from "../primitives/clave-acceso.js";
import { UlidSchema } from "../primitives/ulid.js";

/**
 * Invoice estado (business-side; distinct from SRI estado).
 *
 * `BORRADOR` — pre-emission. `EMITIDO` — handed off to SRI Core. `ANULADO`
 * — flagged for re-issue (SPEC-0032 §FR-7).
 */
export const InvoiceEstadoSchema = z.enum(["BORRADOR", "EMITIDO", "ANULADO"]);
export type InvoiceEstado = z.infer<typeof InvoiceEstadoSchema>;

/**
 * `InvoiceImpuestoSchema` — per-line tax row. The codigo enum mirrors the
 * SRI catalog §9 (IVA / ICE / IRBPNR); `codigoPorcentaje` is the catalog
 * code (e.g. `"4"` for 15% IVA from 2024-04-01); `tarifa` is the percentage
 * carried alongside for transparency.
 */
export const InvoiceImpuestoSchema = z.object({
  codigo: z.enum(["2", "3", "5"]),
  codigoPorcentaje: z.string().regex(/^\d{1,4}$/, "codigoPorcentaje inválido"),
  tarifa: z.number().nonnegative(),
  baseImponible: MoneySchema,
  valor: MoneySchema,
});
export type InvoiceImpuesto = z.infer<typeof InvoiceImpuestoSchema>;

export const InvoiceLineSchema = z.object({
  orden: z.number().int().nonnegative(),
  codigoPrincipal: z.string().min(1).max(25).optional(),
  codigoAuxiliar: z.string().min(1).max(25).optional(),
  descripcion: z.string().min(1).max(300),
  unidadMedida: z.string().min(1).max(50).optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema,
  precioTotalSinImpuesto: MoneySchema,
  impuestos: z.array(InvoiceImpuestoSchema).min(1),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoicePaymentSchema = z.object({
  formaPago: z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]),
  total: MoneySchema,
  plazo: MoneySchema.optional(),
  unidadTiempo: z.string().max(10).optional(),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

export const InvoiceAdicionalSchema = z.object({
  nombre: z.string().min(1).max(300),
  valor: z.string().min(1).max(300),
});
export type InvoiceAdicional = z.infer<typeof InvoiceAdicionalSchema>;

export const InvoiceTotalConImpuestoSchema = z.object({
  codigo: z.enum(["2", "3", "5"]),
  codigoPorcentaje: z.string().regex(/^\d{1,4}$/),
  tarifa: z.number().nonnegative(),
  baseImponible: MoneySchema,
  valor: MoneySchema,
});
export type InvoiceTotalConImpuesto = z.infer<typeof InvoiceTotalConImpuestoSchema>;

/**
 * `InvoiceSchema` — full server-side invoice as returned by the API.
 */
export const InvoiceSchema = z.object({
  id: UlidSchema,
  companyId: UlidSchema,
  customerId: UlidSchema,
  emissionPointId: UlidSchema,
  estado: InvoiceEstadoSchema,
  codDoc: z.literal("01"),
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema.nullable(),
  claveAcceso: ClaveAccesoSchema.nullable(),
  fechaEmision: IsoDateSchema,
  moneda: CurrencyCodeSchema,
  obligadoContabilidad: z.boolean(),
  contribuyenteEspecial: z.string().max(13).nullable(),
  totalSinImpuestos: MoneySchema,
  totalDescuento: MoneySchema,
  totalConImpuestos: z.array(InvoiceTotalConImpuestoSchema),
  propina: MoneySchema,
  importeTotal: MoneySchema,
  lines: z.array(InvoiceLineSchema).min(1),
  payments: z.array(InvoicePaymentSchema).min(1),
  adicionales: z.array(InvoiceAdicionalSchema).max(15),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;
