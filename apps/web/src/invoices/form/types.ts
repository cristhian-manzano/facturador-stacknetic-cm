/**
 * Shared form-field types for the invoice create/edit UI.
 *
 * The RHF form uses STRING-typed money/quantity fields (because the inputs
 * are `<input type="text" inputMode="decimal">`) and converts them to
 * numbers via `parseMoney` at the boundary (preview-totals / PATCH / emit).
 *
 * The shape mirrors `CreateInvoiceSchema` but with the numeric fields as
 * `string` so RHF can hold raw input. We DO NOT keep numbers in the form
 * state — that's the whole point of `parseMoney`.
 */

export type FormaPagoCode = "01" | "15" | "16" | "17" | "18" | "19" | "20" | "21";

export interface InvoiceLineFormValues {
  /** Optional code. Empty string -> omit. */
  readonly codigoPrincipal?: string;
  readonly codigoAuxiliar?: string;
  readonly descripcion: string;
  readonly unidadMedida?: string;
  /** Raw text from the input; parsed via `parseMoney` at the boundary. */
  readonly cantidad: string;
  readonly precioUnitario: string;
  readonly descuento: string;
  /** Single IVA row per line; the SRI supports more but the UI exposes one. */
  readonly codigoPorcentaje: string;
  /** Numeric tarifa kept in sync with `codigoPorcentaje`. */
  readonly tarifa: number;
}

export interface InvoicePaymentFormValues {
  readonly formaPago: FormaPagoCode;
  readonly total: string;
  readonly plazo?: string;
  readonly unidadTiempo?: string;
}

export interface InvoiceAdicionalFormValues {
  readonly nombre: string;
  readonly valor: string;
}

export interface InvoiceFormValues {
  /** ULID of the selected emission point. Required. */
  emissionPointId: string;
  /** ULID of the selected customer. Required. */
  customerId: string;
  /** `YYYY-MM-DD` (local Ecuador date). */
  fechaEmision: string;
  lines: InvoiceLineFormValues[];
  payments: InvoicePaymentFormValues[];
  adicionales: InvoiceAdicionalFormValues[];
}
