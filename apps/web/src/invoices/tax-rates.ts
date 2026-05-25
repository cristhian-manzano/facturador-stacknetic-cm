/**
 * Client-side mirror of the API's IVA selector (SPEC-0032 §FR-6).
 *
 * Kept INTENTIONALLY small (and deduped against `apps/api/src/invoices/
 * tax-rates.ts`): the UI only needs the default rate for the IVA selector
 * dropdown and the catalog row labels. The server is the authority on
 * `validFrom` / `validTo` enforcement.
 *
 * Why we don't import from `apps/api`: cross-app imports would couple the
 * web bundle to Express types. The few constants below are stable per
 * SPEC-0032 and tested for parity in `tax-rates.test.ts`.
 */

export const IVA_CODIGO = "2";

export interface IvaCatalogRow {
  readonly codigo: typeof IVA_CODIGO;
  readonly codigoPorcentaje: string;
  readonly tarifa: number | null;
  readonly label: string;
}

/**
 * Catalog rows the UI surfaces. Order matches the dropdown rendering
 * (default rate first, then the historical / exempt ones).
 */
export const IVA_TABLE: readonly IvaCatalogRow[] = [
  { codigo: IVA_CODIGO, codigoPorcentaje: "4", tarifa: 15, label: "15%" },
  { codigo: IVA_CODIGO, codigoPorcentaje: "2", tarifa: 12, label: "12% (histórico)" },
  { codigo: IVA_CODIGO, codigoPorcentaje: "0", tarifa: 0, label: "0%" },
  { codigo: IVA_CODIGO, codigoPorcentaje: "6", tarifa: 0, label: "No objeto IVA" },
  { codigo: IVA_CODIGO, codigoPorcentaje: "7", tarifa: 0, label: "Exento" },
  { codigo: IVA_CODIGO, codigoPorcentaje: "5", tarifa: 5, label: "5% construcción" },
];

export const IVA_15_EFFECTIVE_FROM = "2024-04-01";

export interface PickIvaCodeResult {
  readonly codigo: typeof IVA_CODIGO;
  readonly codigoPorcentaje: string;
  readonly tarifa: number;
}

/**
 * Default IVA row for an ISO date string (`YYYY-MM-DD`). Pure: no clock,
 * no I/O. Used to populate the IVA selector on new line addition.
 *
 *   - `< 2024-04-01` → 12% (codigoPorcentaje "2").
 *   - `>= 2024-04-01` → 15% (codigoPorcentaje "4").
 */
export function pickIvaCode(fechaEmision: string): PickIvaCodeResult {
  // Lexicographic compare on `YYYY-MM-DD` is total + correct for the
  // calendar-day question the boundary asks (same trick the API uses).
  if (fechaEmision >= IVA_15_EFFECTIVE_FROM) {
    return { codigo: IVA_CODIGO, codigoPorcentaje: "4", tarifa: 15 };
  }
  return { codigo: IVA_CODIGO, codigoPorcentaje: "2", tarifa: 12 };
}

/**
 * Look up a row by `codigoPorcentaje`. Returns `undefined` for unknown
 * codes; the form layer rejects unknown selections via the Zod schema
 * before they ever reach the server.
 */
export function getIvaRow(codigoPorcentaje: string): IvaCatalogRow | undefined {
  return IVA_TABLE.find((r) => r.codigoPorcentaje === codigoPorcentaje);
}

/**
 * Payment method (forma de pago) catalog — SRI catalog values. The values
 * MUST match the enum in `@facturador/contracts/invoices` CreateInvoice
 * schema.
 */
export interface FormaPagoRow {
  readonly codigo: "01" | "15" | "16" | "17" | "18" | "19" | "20" | "21";
  readonly label: string;
}

export const FORMA_PAGO_TABLE: readonly FormaPagoRow[] = [
  { codigo: "01", label: "Sin utilización del sistema financiero" },
  { codigo: "15", label: "Compensación de deudas" },
  { codigo: "16", label: "Tarjeta de débito" },
  { codigo: "17", label: "Dinero electrónico" },
  { codigo: "18", label: "Tarjeta prepago" },
  { codigo: "19", label: "Tarjeta de crédito" },
  { codigo: "20", label: "Otros con utilización del sistema financiero" },
  { codigo: "21", label: "Endoso de títulos" },
];

/**
 * Tipo identificación catalog for the NewCustomerDialog. Mirrors the
 * `tipoIdentificacion` discriminator in `CustomerInputSchema`.
 */
export interface TipoIdentificacionRow {
  readonly codigo: "04" | "05" | "06" | "07" | "08";
  readonly label: string;
}

export const TIPO_IDENTIFICACION_TABLE: readonly TipoIdentificacionRow[] = [
  { codigo: "05", label: "Cédula" },
  { codigo: "04", label: "RUC" },
  { codigo: "06", label: "Pasaporte" },
  { codigo: "08", label: "Identificación del exterior" },
  { codigo: "07", label: "Consumidor final" },
];
