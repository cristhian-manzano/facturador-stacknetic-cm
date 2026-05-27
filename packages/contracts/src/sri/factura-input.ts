/**
 * `FacturaXmlInputSchema` — shape consumed by `apps/sri-core`'s
 * factura XML builder (SPEC-0023 §6.2).
 *
 * One Zod schema per `<xs:complexType>` in
 * `docs/sri/factura/factura_V2.1.0.xsd`. Every field below mirrors an
 * `<xs:element>` declared inside the corresponding `<xs:sequence>`.
 *
 * Out of scope for this milestone (SPEC-0023 §2): `comercioExterior`
 * fields, `compensaciones`, `retenciones`, `reembolsos`,
 * `infoSustitutivaGuiaRemision`, `otrosRubrosTerceros`, `tipoNegociable`,
 * `maquinaFiscal`. The XSD allows them via `minOccurs="0"`; the schema
 * below intentionally omits them so the contract surface tracks the
 * supported factura flow. Future specs (NC, ND, export, retención)
 * extend the schema rather than relaxing it.
 *
 * Money / quantity discipline (SPEC-0023 §FR-4):
 *   - 2-decimal monetary fields use `MoneySchema`.
 *   - 6-decimal quantity / unit price fields use `MoneyQtySchema`.
 *   - `tarifa` uses `z.number()` because the XSD allows 4 total digits / 2
 *     fractional. The builder always emits `.toFixed(2)`.
 *
 * Primitives are re-exported from `@facturador/contracts/primitives` so
 * the same RUC / claveAcceso / fechaEmision rules used by API and DB
 * layers gate the XML input too.
 */
import { z } from "zod";

import {
  AmbienteSchema,
  ClaveAccesoSchema,
  EstabSchema,
  PtoEmiSchema,
  SecuencialSchema,
  FechaEmisionSchema,
  MoneySchema,
  MoneyQtySchema,
} from "../primitives/index.js";

// `[^\n]*` mirrors the XSD pattern reused for every free-text field.
const SriTextNoNewline = (max: number, label: string) =>
  z
    .string()
    .min(1, `${label} no puede estar vacío`)
    .max(max, `${label} excede ${String(max)} caracteres`)
    .regex(/^[^\n]*$/u, `${label} no puede contener saltos de línea`);

// Tax codes per docs/sri-facturacion-electronica-ecuador.md §9
// (`2` IVA, `3` ICE, `5` IRBPNR). Other SRI codes (6 ISD, 8 reserved)
// are not used inside factura `<impuesto>` elements per the XSD `codigo`
// pattern `[235]`.
export const ImpuestoCodigoSchema = z.enum(["2", "3", "5"]);
export type ImpuestoCodigo = z.infer<typeof ImpuestoCodigoSchema>;

// `codigoPorcentaje` accepts 1–4 digits (XSD `[0-9]+`, max 4). The list
// of allowed values for `codigo=2` (IVA) lives in the docs; we accept
// the lexical superset and rely on SRI to reject unsupported values
// for a given fechaEmision.
const CodigoPorcentajeSchema = z
  .string()
  .regex(/^\d{1,4}$/u, "codigoPorcentaje debe tener 1–4 dígitos");

// Buyer identification type, per XSD `tipoIdentificacionComprador`
// (pattern `[0][4-8]`): 04 RUC, 05 cédula, 06 pasaporte,
// 07 consumidor final, 08 identificación del exterior.
export const TipoIdentificacionCompradorSchema = z.enum(["04", "05", "06", "07", "08"]);
export type TipoIdentificacionComprador = z.infer<typeof TipoIdentificacionCompradorSchema>;

// `tarifa` is a percentage. XSD: totalDigits=4, fractionDigits=2,
// minInclusive=0 → 0.00 to 99.99.
const TarifaSchema = z
  .number()
  .nonnegative("tarifa no puede ser negativa")
  .lte(99.99, "tarifa excede 99.99");

// `formaPago` per XSD `[0][1-9]|[1][0-9]|[2][0-1]` (catálogo SRI: 01,
// 15..21 are the active codes; we list them explicitly for type-safety).
export const FormaPagoSchema = z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]);
export type FormaPago = z.infer<typeof FormaPagoSchema>;

const InfoTributariaSchema = z.object({
  ambiente: AmbienteSchema,
  // `tipoEmision` per glossary: `1` = emisión normal. We do not support
  // contingencia (`2`) in the V1 milestone but the field is left as a
  // literal so callers can't accidentally widen it.
  tipoEmision: z.literal("1"),
  razonSocial: SriTextNoNewline(300, "razonSocial"),
  nombreComercial: SriTextNoNewline(300, "nombreComercial").optional(),
  // RUC: 13 digits ending in 001. The full RUC checksum is enforced by
  // `RucSchema` upstream; here we keep the XSD pattern only because
  // synthetic test RUCs (province 99) might fail the checksum.
  ruc: z.string().regex(/^\d{10}001$/u, "ruc debe tener 13 dígitos y terminar en 001"),
  claveAcceso: ClaveAccesoSchema,
  // `codDoc` = "01" for factura. Literal so the schema can't be reused
  // for NC/ND/Retención/Guía without an explicit edit.
  codDoc: z.literal("01"),
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema,
  dirMatriz: SriTextNoNewline(300, "dirMatriz"),
  agenteRetencion: z
    .string()
    .regex(/^\d{1,8}$/u, "agenteRetencion debe tener 1–8 dígitos")
    .optional(),
  contribuyenteRimpe: z.literal("CONTRIBUYENTE RÉGIMEN RIMPE").optional(),
});

const TotalImpuestoSchema = z.object({
  codigo: ImpuestoCodigoSchema,
  codigoPorcentaje: CodigoPorcentajeSchema,
  descuentoAdicional: MoneySchema.optional(),
  baseImponible: MoneySchema,
  tarifa: TarifaSchema.optional(),
  valor: MoneySchema,
  valorDevolucionIva: MoneySchema.optional(),
});

const PagoSchema = z.object({
  formaPago: FormaPagoSchema,
  total: MoneySchema,
  plazo: MoneySchema.optional(),
  unidadTiempo: SriTextNoNewline(10, "unidadTiempo").optional(),
});

const InfoFacturaSchema = z.object({
  fechaEmision: FechaEmisionSchema,
  dirEstablecimiento: SriTextNoNewline(300, "dirEstablecimiento").optional(),
  contribuyenteEspecial: z
    .string()
    .min(3, "contribuyenteEspecial mínimo 3 chars")
    .max(13, "contribuyenteEspecial máximo 13 chars")
    .regex(/^[A-Za-z0-9]*$/u, "contribuyenteEspecial alfanumérico")
    .optional(),
  obligadoContabilidad: z.enum(["SI", "NO"]).optional(),
  tipoIdentificacionComprador: TipoIdentificacionCompradorSchema,
  guiaRemision: z
    .string()
    .regex(/^\d{3}-\d{3}-\d{9}$/u, "guiaRemision debe tener formato 000-000-000000000")
    .optional(),
  razonSocialComprador: SriTextNoNewline(300, "razonSocialComprador"),
  identificacionComprador: SriTextNoNewline(20, "identificacionComprador"),
  direccionComprador: SriTextNoNewline(300, "direccionComprador").optional(),
  totalSinImpuestos: MoneySchema,
  totalDescuento: MoneySchema,
  totalConImpuestos: z.array(TotalImpuestoSchema).min(1),
  propina: MoneySchema.optional(),
  importeTotal: MoneySchema,
  moneda: SriTextNoNewline(15, "moneda").optional(),
  pagos: z.array(PagoSchema).min(1),
});

const DetalleImpuestoSchema = z.object({
  codigo: ImpuestoCodigoSchema,
  codigoPorcentaje: CodigoPorcentajeSchema,
  tarifa: TarifaSchema,
  baseImponible: MoneySchema,
  valor: MoneySchema,
});

const DetAdicionalSchema = z.object({
  nombre: z
    .string()
    .min(1, "detAdicional.nombre vacío")
    .max(300, "detAdicional.nombre excede 300 chars"),
  valor: z
    .string()
    .min(1, "detAdicional.valor vacío")
    .max(300, "detAdicional.valor excede 300 chars"),
});

const DetalleSchema = z.object({
  codigoPrincipal: SriTextNoNewline(25, "codigoPrincipal").optional(),
  codigoAuxiliar: SriTextNoNewline(25, "codigoAuxiliar").optional(),
  // `descripcion` accepts up to 300 chars and `\n`/control chars. The
  // builder sanitises (PROMPT-0023 §FR-6); we don't reject here because
  // the policy is "trim & strip", not "fail".
  descripcion: z
    .string()
    .min(1, "descripcion vacía")
    .max(2000, "descripcion excede 2000 chars antes de sanitisar"),
  unidadMedida: SriTextNoNewline(50, "unidadMedida").optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema,
  precioTotalSinImpuesto: MoneySchema,
  detallesAdicionales: z.array(DetAdicionalSchema).max(3).optional(),
  impuestos: z.array(DetalleImpuestoSchema).min(1),
});

const CampoAdicionalSchema = z.object({
  nombre: z
    .string()
    .min(1, "campoAdicional.nombre vacío")
    .max(300, "campoAdicional.nombre excede 300 chars"),
  valor: z
    .string()
    .min(1, "campoAdicional.valor vacío")
    .max(300, "campoAdicional.valor excede 300 chars"),
});

export const FacturaXmlInputSchema = z.object({
  infoTributaria: InfoTributariaSchema,
  infoFactura: InfoFacturaSchema,
  detalles: z.array(DetalleSchema).min(1),
  infoAdicional: z.array(CampoAdicionalSchema).max(15).optional(),
});

export type FacturaXmlInput = z.infer<typeof FacturaXmlInputSchema>;
export type FacturaXmlInfoTributaria = z.infer<typeof InfoTributariaSchema>;
export type FacturaXmlInfoFactura = z.infer<typeof InfoFacturaSchema>;
export type FacturaXmlDetalle = z.infer<typeof DetalleSchema>;
export type FacturaXmlPago = z.infer<typeof PagoSchema>;
export type FacturaXmlTotalImpuesto = z.infer<typeof TotalImpuestoSchema>;
export type FacturaXmlDetalleImpuesto = z.infer<typeof DetalleImpuestoSchema>;
export type FacturaXmlCampoAdicional = z.infer<typeof CampoAdicionalSchema>;
export type FacturaXmlDetAdicional = z.infer<typeof DetAdicionalSchema>;
