/**
 * Web-side tax-rates barrel.
 *
 * IVA bits (table + selector + helpers) are RE-EXPORTED from
 * `@facturador/contracts/sri` so the api and web share the SINGLE source
 * of truth (REVIEW-0042 §2). Web-specific catalogs that have no api
 * counterpart (forma de pago, tipo identificación for the customer
 * dialog) stay here.
 *
 * If you find yourself adding an IVA helper here, add it to
 * `packages/contracts/src/sri/iva.ts` and re-export below instead.
 */

export {
  IVA_CODIGO,
  IVA_15_EFFECTIVE_FROM,
  IVA_TABLE,
  pickIvaCode,
  getIvaRow,
  type IvaCatalogRow,
  type PickIvaCodeResult,
} from "@facturador/contracts/sri";

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
