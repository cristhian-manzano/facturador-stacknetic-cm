/**
 * `buildFacturaXml` — pure, deterministic factura V2.1.0 XML emitter
 * (SPEC-0023, PLAN-0023, TASKS-0023).
 *
 * Why hand-rolled string concatenation rather than xmlbuilder2/fast-xml?
 *
 *   - We need **byte-deterministic** output. Downstream XAdES-BES signing
 *     hashes a UTF-8 byte slice and any reorder, comment, or whitespace
 *     drift would invalidate the signature on every re-build (PLAN-0023
 *     §3, SPEC-0024).
 *   - The element ordering is governed by the XSD `<xs:sequence>` (see
 *     `docs/sri/factura/factura_V2.1.0.xsd`). Hand-coding the order means
 *     the linter — and the eye — can verify it against the XSD line-by-line.
 *   - Optional fields must be omitted when absent (not emitted as
 *     `<foo></foo>`). String concatenation makes this trivial.
 *
 * The function never reads `process.env`, never logs, never touches the
 * filesystem. The accompanying validator (`validate.ts`) handles XSD
 * resolution; this file is fully pure.
 *
 * Output shape:
 *   - `xml`: `<?xml version="1.0" encoding="UTF-8"?>` + document body.
 *   - `xmlForSigning`: document body only. This is what XAdES signs; the
 *     declaration is not part of the C14N canonical form for enveloped
 *     signatures.
 *
 * Validation strategy: every call parses the input through
 * `FacturaXmlInputSchema` (Zod). A failure surfaces as
 * `XmlBuildError({code:"MISSING_FIELD"|...})`. We also re-validate the
 * IVA `codigoPorcentaje` against the docs whitelist because Zod is too
 * permissive (XSD allows `[0-9]{1,4}` but SRI only honours a known set).
 */
import type { ZodError } from "zod";

import { FacturaXmlInputSchema, type FacturaXmlInput } from "@facturador/contracts/sri";

import { cleanDescripcion, cleanSingleLineText, escapeXml } from "./sanitise.js";

/* -------------------------------------------------------------------------- */
/*                                  Errors                                    */
/* -------------------------------------------------------------------------- */

/** Discriminated error code surfaced by {@link buildFacturaXml}. */
export type XmlBuildErrorCode = "MISSING_FIELD" | "INVALID_TAX_CODE" | "INVALID_INPUT";

/**
 * Typed error thrown by the builder. The `path` is dot-joined and points
 * at the offending field; it never includes the offending value so it's
 * safe to surface to clients without leaking PII.
 */
export class XmlBuildError extends Error {
  public readonly code: XmlBuildErrorCode;
  public readonly path: string;
  public readonly details?: readonly string[];

  public constructor(
    code: XmlBuildErrorCode,
    path: string,
    message: string,
    details?: readonly string[],
  ) {
    super(message);
    this.name = "XmlBuildError";
    this.code = code;
    this.path = path;
    if (details) this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/*                            Number formatters                               */
/* -------------------------------------------------------------------------- */

/**
 * 2-decimal monetary formatter. Use for any XSD-typed `totalSinImpuestos`,
 * `baseImponible`, `valor`, etc. Negative zero collapses to `0.00` to
 * preserve byte equality with the golden fixture.
 */
const t2 = (n: number): string => {
  if (Object.is(n, -0)) return "0.00";
  return n.toFixed(2);
};

/**
 * 6-decimal formatter for cantidades / precioUnitario. SRI ficha técnica
 * §8 requires up to 6 decimals; we always emit exactly 6 to match the
 * sample XML in `docs/sri/factura/factura_V2.1.0.xml`.
 */
const t6 = (n: number): string => {
  if (Object.is(n, -0)) return "0.000000";
  return n.toFixed(6);
};

/* -------------------------------------------------------------------------- */
/*                         XML element helpers                                */
/* -------------------------------------------------------------------------- */

/** Wrap `body` in `<tag>…</tag>`. `body` MUST already be XML-safe. */
const el = (tag: string, body: string): string => `<${tag}>${body}</${tag}>`;

/**
 * Conditional element. Returns `""` when `value` is `undefined`, `null`,
 * or `""`. The empty case produces no XML output at all — *never* an
 * empty `<tag/>` (SPEC-0023 §FR-3).
 *
 * `value` is expected to be already-formatted (i.e. the caller invokes
 * `t2`/`t6` for numbers and `escapeXml`/`cleanSingleLineText` for text).
 */
const elIf = (tag: string, value: string | undefined | null): string => {
  if (value === undefined || value === null || value === "") return "";
  return el(tag, value);
};

/** Format an XML element with attributes. Attribute order is preserved. */
const elAttr = (
  tag: string,
  attrs: readonly (readonly [string, string])[],
  body: string,
): string => {
  const attrStr = attrs.map(([k, v]) => ` ${k}="${v}"`).join("");
  return `<${tag}${attrStr}>${body}</${tag}>`;
};

/**
 * Self-closing element with attributes (`<detAdicional nombre="…" valor="…"/>`).
 * The attribute values MUST already be XML-escaped.
 */
const selfClosingAttr = (tag: string, attrs: readonly (readonly [string, string])[]): string => {
  const attrStr = attrs.map(([k, v]) => ` ${k}="${v}"`).join("");
  return `<${tag}${attrStr}/>`;
};

/* -------------------------------------------------------------------------- */
/*                            Validation helpers                              */
/* -------------------------------------------------------------------------- */

/**
 * SRI-approved `codigoPorcentaje` values for IVA (`codigo=2`), per
 * `docs/sri-facturacion-electronica-ecuador.md` §9. Values are tracked
 * here because the XSD allows the broader `[0-9]{1,4}` range; SRI will
 * reject any non-listed code at recepción with `60: CÓDIGO IMPUESTO NO
 * EXISTE`. We surface that failure at build time so the caller never
 * pays the SOAP round-trip cost for an avoidable mistake.
 *
 *  - `0` 0%
 *  - `2` 12% (histórico ≤ mar-2024)
 *  - `3` 14% (histórico 2017)
 *  - `4` 15% (vigente desde abr-2024)
 *  - `5` 5% (construcción)
 *  - `6` No objeto de IVA
 *  - `7` Exento de IVA
 *  - `8` IVA diferenciado
 */
const IVA_CODIGO_PORCENTAJE_WHITELIST: ReadonlySet<string> = new Set([
  "0",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
]);

/**
 * ICE and IRBPNR have their own (large) catalogs that vary by resolution.
 * For v1 we accept the XSD-level pattern `[0-9]{1,4}` for those families
 * and let SRI's recepción be the source of truth. Adding catalogue
 * tables here without a corresponding spec would create stale data.
 */
const isAllowedTaxCode = (codigo: string, codigoPorcentaje: string): boolean => {
  if (codigo === "2") return IVA_CODIGO_PORCENTAJE_WHITELIST.has(codigoPorcentaje);
  // ICE (3) and IRBPNR (5): pattern-only check.
  return /^\d{1,4}$/.test(codigoPorcentaje);
};

/* -------------------------------------------------------------------------- */
/*                         Element ordering constants                         */
/* -------------------------------------------------------------------------- */

/**
 * The XSD `<xs:sequence>` for `infoTributaria` (`factura_V2.1.0.xsd`
 * lines 39–53). Keep this list in literal XSD order; reorderings break
 * XSD validation and are forbidden by SPEC-0023 §FR-2.
 */
const INFO_TRIBUTARIA_ORDER = [
  "ambiente",
  "tipoEmision",
  "razonSocial",
  "nombreComercial",
  "ruc",
  "claveAcceso",
  "codDoc",
  "estab",
  "ptoEmi",
  "secuencial",
  "dirMatriz",
  "agenteRetencion",
  "contribuyenteRimpe",
] as const;

/**
 * `infoFactura` sequence (XSD lines 870–927). Includes optional fields
 * the V1 milestone doesn't emit yet (comercioExterior, fleteInternacional,
 * etc.) so the order constant stays a faithful copy of the XSD.
 */
const INFO_FACTURA_ORDER = [
  "fechaEmision",
  "dirEstablecimiento",
  "contribuyenteEspecial",
  "obligadoContabilidad",
  "tipoIdentificacionComprador",
  "guiaRemision",
  "razonSocialComprador",
  "identificacionComprador",
  "direccionComprador",
  "totalSinImpuestos",
  "totalDescuento",
  "totalConImpuestos",
  "propina",
  "importeTotal",
  "moneda",
  "pagos",
] as const;

/** `<detalle>` sequence (XSD lines 933–977). */
const DETALLE_ORDER = [
  "codigoPrincipal",
  "codigoAuxiliar",
  "descripcion",
  "unidadMedida",
  "cantidad",
  "precioUnitario",
  "descuento",
  "precioTotalSinImpuesto",
  "detallesAdicionales",
  "impuestos",
] as const;

/** `<impuesto>` sequence inside a `<detalle>` (XSD `impuesto` complexType). */
const DETALLE_IMPUESTO_ORDER = [
  "codigo",
  "codigoPorcentaje",
  "tarifa",
  "baseImponible",
  "valor",
] as const;

/** `<totalImpuesto>` sequence inside `<totalConImpuestos>` (XSD lines 899–911). */
const TOTAL_IMPUESTO_ORDER = [
  "codigo",
  "codigoPorcentaje",
  "descuentoAdicional",
  "baseImponible",
  "tarifa",
  "valor",
  "valorDevolucionIva",
] as const;

/** `<pago>` sequence (XSD `pagos.pago`). */
const PAGO_ORDER = ["formaPago", "total", "plazo", "unidadTiempo"] as const;

/* -------------------------------------------------------------------------- */
/*                                  Builder                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build the `<infoTributaria>` block in XSD-defined order.
 *
 * The `parts` map is keyed by element name; we then iterate
 * `INFO_TRIBUTARIA_ORDER` to guarantee the emitted sequence is identical
 * to the XSD, regardless of the literal key order in `parts`.
 */
const buildInfoTributaria = (i: FacturaXmlInput["infoTributaria"]): string => {
  const parts: Record<string, string> = {
    ambiente: el("ambiente", i.ambiente),
    tipoEmision: el("tipoEmision", i.tipoEmision),
    razonSocial: el("razonSocial", escapeXml(cleanSingleLineText(i.razonSocial))),
    nombreComercial:
      i.nombreComercial !== undefined
        ? el("nombreComercial", escapeXml(cleanSingleLineText(i.nombreComercial)))
        : "",
    ruc: el("ruc", i.ruc),
    claveAcceso: el("claveAcceso", i.claveAcceso),
    codDoc: el("codDoc", i.codDoc),
    estab: el("estab", i.estab),
    ptoEmi: el("ptoEmi", i.ptoEmi),
    secuencial: el("secuencial", i.secuencial),
    dirMatriz: el("dirMatriz", escapeXml(cleanSingleLineText(i.dirMatriz))),
    agenteRetencion: elIf("agenteRetencion", i.agenteRetencion),
    // `contribuyenteRimpe` is a literal string per XSD; no escaping needed.
    contribuyenteRimpe: elIf("contribuyenteRimpe", i.contribuyenteRimpe),
  };
  return INFO_TRIBUTARIA_ORDER.map((k) => parts[k] ?? "").join("");
};

const buildTotalConImpuestos = (
  totales: FacturaXmlInput["infoFactura"]["totalConImpuestos"],
  basePath: string,
): string => {
  const items = totales.map((t, idx) => {
    if (!isAllowedTaxCode(t.codigo, t.codigoPorcentaje)) {
      throw new XmlBuildError(
        "INVALID_TAX_CODE",
        `${basePath}.${String(idx)}.codigoPorcentaje`,
        `tax code combination codigo=${t.codigo} codigoPorcentaje=${t.codigoPorcentaje} is not in the SRI catalogue`,
      );
    }
    const parts: Record<string, string> = {
      codigo: el("codigo", t.codigo),
      codigoPorcentaje: el("codigoPorcentaje", t.codigoPorcentaje),
      descuentoAdicional:
        t.descuentoAdicional !== undefined
          ? el("descuentoAdicional", t2(t.descuentoAdicional))
          : "",
      baseImponible: el("baseImponible", t2(t.baseImponible)),
      tarifa: t.tarifa !== undefined ? el("tarifa", t2(t.tarifa)) : "",
      valor: el("valor", t2(t.valor)),
      valorDevolucionIva:
        t.valorDevolucionIva !== undefined
          ? el("valorDevolucionIva", t2(t.valorDevolucionIva))
          : "",
    };
    return el("totalImpuesto", TOTAL_IMPUESTO_ORDER.map((k) => parts[k] ?? "").join(""));
  });
  return el("totalConImpuestos", items.join(""));
};

const buildPagos = (pagos: FacturaXmlInput["infoFactura"]["pagos"]): string => {
  const items = pagos.map((p) => {
    const parts: Record<string, string> = {
      formaPago: el("formaPago", p.formaPago),
      total: el("total", t2(p.total)),
      plazo: p.plazo !== undefined ? el("plazo", t2(p.plazo)) : "",
      unidadTiempo:
        p.unidadTiempo !== undefined
          ? el("unidadTiempo", escapeXml(cleanSingleLineText(p.unidadTiempo)))
          : "",
    };
    return el("pago", PAGO_ORDER.map((k) => parts[k] ?? "").join(""));
  });
  return el("pagos", items.join(""));
};

const buildInfoFactura = (f: FacturaXmlInput["infoFactura"], basePath: string): string => {
  const parts: Record<string, string> = {
    fechaEmision: el("fechaEmision", f.fechaEmision),
    dirEstablecimiento:
      f.dirEstablecimiento !== undefined
        ? el("dirEstablecimiento", escapeXml(cleanSingleLineText(f.dirEstablecimiento)))
        : "",
    contribuyenteEspecial:
      f.contribuyenteEspecial !== undefined
        ? el("contribuyenteEspecial", f.contribuyenteEspecial)
        : "",
    obligadoContabilidad:
      f.obligadoContabilidad !== undefined
        ? el("obligadoContabilidad", f.obligadoContabilidad)
        : "",
    tipoIdentificacionComprador: el("tipoIdentificacionComprador", f.tipoIdentificacionComprador),
    guiaRemision: f.guiaRemision !== undefined ? el("guiaRemision", f.guiaRemision) : "",
    razonSocialComprador: el(
      "razonSocialComprador",
      escapeXml(cleanSingleLineText(f.razonSocialComprador)),
    ),
    identificacionComprador: el(
      "identificacionComprador",
      escapeXml(cleanSingleLineText(f.identificacionComprador)),
    ),
    direccionComprador:
      f.direccionComprador !== undefined
        ? el("direccionComprador", escapeXml(cleanSingleLineText(f.direccionComprador)))
        : "",
    totalSinImpuestos: el("totalSinImpuestos", t2(f.totalSinImpuestos)),
    totalDescuento: el("totalDescuento", t2(f.totalDescuento)),
    totalConImpuestos: buildTotalConImpuestos(f.totalConImpuestos, `${basePath}.totalConImpuestos`),
    propina: f.propina !== undefined ? el("propina", t2(f.propina)) : "",
    importeTotal: el("importeTotal", t2(f.importeTotal)),
    moneda: f.moneda !== undefined ? el("moneda", escapeXml(cleanSingleLineText(f.moneda))) : "",
    pagos: buildPagos(f.pagos),
  };
  return INFO_FACTURA_ORDER.map((k) => parts[k] ?? "").join("");
};

const buildDetalles = (detalles: FacturaXmlInput["detalles"], basePath: string): string => {
  const items = detalles.map((d, idx) => {
    const detallePath = `${basePath}.${String(idx)}`;
    const impuestosBody = d.impuestos
      .map((imp, impIdx) => {
        if (!isAllowedTaxCode(imp.codigo, imp.codigoPorcentaje)) {
          throw new XmlBuildError(
            "INVALID_TAX_CODE",
            `${detallePath}.impuestos.${String(impIdx)}.codigoPorcentaje`,
            `tax code combination codigo=${imp.codigo} codigoPorcentaje=${imp.codigoPorcentaje} is not in the SRI catalogue`,
          );
        }
        const parts: Record<string, string> = {
          codigo: el("codigo", imp.codigo),
          codigoPorcentaje: el("codigoPorcentaje", imp.codigoPorcentaje),
          tarifa: el("tarifa", t2(imp.tarifa)),
          baseImponible: el("baseImponible", t2(imp.baseImponible)),
          valor: el("valor", t2(imp.valor)),
        };
        return el("impuesto", DETALLE_IMPUESTO_ORDER.map((k) => parts[k] ?? "").join(""));
      })
      .join("");

    const detalleParts: Record<string, string> = {
      codigoPrincipal:
        d.codigoPrincipal !== undefined
          ? el("codigoPrincipal", escapeXml(cleanSingleLineText(d.codigoPrincipal)))
          : "",
      codigoAuxiliar:
        d.codigoAuxiliar !== undefined
          ? el("codigoAuxiliar", escapeXml(cleanSingleLineText(d.codigoAuxiliar)))
          : "",
      descripcion: el("descripcion", escapeXml(cleanDescripcion(d.descripcion))),
      unidadMedida:
        d.unidadMedida !== undefined
          ? el("unidadMedida", escapeXml(cleanSingleLineText(d.unidadMedida)))
          : "",
      cantidad: el("cantidad", t6(d.cantidad)),
      precioUnitario: el("precioUnitario", t6(d.precioUnitario)),
      descuento: el("descuento", t2(d.descuento)),
      precioTotalSinImpuesto: el("precioTotalSinImpuesto", t2(d.precioTotalSinImpuesto)),
      detallesAdicionales:
        d.detallesAdicionales && d.detallesAdicionales.length > 0
          ? el(
              "detallesAdicionales",
              d.detallesAdicionales
                .map((a) =>
                  selfClosingAttr("detAdicional", [
                    ["nombre", escapeXml(a.nombre)],
                    ["valor", escapeXml(a.valor)],
                  ]),
                )
                .join(""),
            )
          : "",
      impuestos: el("impuestos", impuestosBody),
    };

    return el("detalle", DETALLE_ORDER.map((k) => detalleParts[k] ?? "").join(""));
  });
  return el("detalles", items.join(""));
};

const buildInfoAdicional = (
  infoAdicional: NonNullable<FacturaXmlInput["infoAdicional"]>,
): string => {
  const items = infoAdicional
    .map((a) => elAttr("campoAdicional", [["nombre", escapeXml(a.nombre)]], escapeXml(a.valor)))
    .join("");
  return el("infoAdicional", items);
};

/** Result of {@link buildFacturaXml}. */
export interface BuildFacturaXmlResult {
  /** Full XML including the `<?xml version="1.0" encoding="UTF-8"?>` declaration. */
  readonly xml: string;
  /** Document body only — XAdES signs this string (no declaration). */
  readonly xmlForSigning: string;
}

/**
 * Build a canonical SRI factura V2.1.0 XML.
 *
 * Steps (in order):
 *   1. Parse the input through `FacturaXmlInputSchema`. Failures surface
 *      as `XmlBuildError({code:"INVALID_INPUT"|"MISSING_FIELD"})`.
 *   2. Build each `<xs:sequence>` block in XSD order using explicit
 *      const arrays — never iterating object keys.
 *   3. Stitch the blocks under `<factura id="comprobante" version="2.1.0">`.
 *
 * The output is byte-deterministic given the same input.
 */
export const buildFacturaXml = (input: unknown): BuildFacturaXmlResult => {
  const parsed = FacturaXmlInputSchema.safeParse(input);
  if (!parsed.success) {
    throw fromZodError(parsed.error);
  }
  const data: FacturaXmlInput = parsed.data;

  const infoTributaria = buildInfoTributaria(data.infoTributaria);
  const infoFactura = buildInfoFactura(data.infoFactura, "infoFactura");
  const detalles = buildDetalles(data.detalles, "detalles");
  const infoAdicional =
    data.infoAdicional && data.infoAdicional.length > 0
      ? buildInfoAdicional(data.infoAdicional)
      : "";

  const body =
    `<factura id="comprobante" version="2.1.0">` +
    el("infoTributaria", infoTributaria) +
    el("infoFactura", infoFactura) +
    detalles +
    infoAdicional +
    `</factura>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>` + body;
  return { xml, xmlForSigning: body };
};

/**
 * Translate a `ZodError` into our typed `XmlBuildError`. We treat
 * "required field missing" as `MISSING_FIELD` and everything else as
 * `INVALID_INPUT`. The full Zod issue list is preserved under `details`
 * so callers can debug — we don't include the offending value in the
 * top-level message because it might be PII (a buyer name, an
 * identificación).
 */
const fromZodError = (err: ZodError): XmlBuildError => {
  const issue = err.issues[0];
  const path = issue ? issue.path.join(".") : "(root)";
  const details = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`);
  const isMissing =
    issue?.code === "invalid_type" && (issue.received === "undefined" || issue.received === "null");
  const code: XmlBuildErrorCode = isMissing ? "MISSING_FIELD" : "INVALID_INPUT";
  const message = isMissing
    ? `required field missing at ${path}`
    : `factura input failed schema validation at ${path}`;
  return new XmlBuildError(code, path, message, details);
};
