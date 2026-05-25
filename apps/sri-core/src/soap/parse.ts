/**
 * Resilient SOAP-response parsers for SRI's recepción + autorización
 * web services.
 *
 * Design rules (locked by SPEC-0025 §6.5 + TASKS-0025 §3 + docs §11):
 *   - Every XPath query uses `local-name()` so the parser tolerates
 *     namespace prefix drift between SRI environments (we have seen
 *     both `ns2:`, `soap:` and bare elements in the wild).
 *   - The parser ignores the SOAP envelope wrapper — it walks straight
 *     to the meaningful elements.
 *   - Mensaje identifier "43" ("CLAVE ACCESO REGISTRADA") on a DEVUELTA
 *     response is reclassified as RECIBIDA (idempotent re-send). This
 *     is the only domain rule baked into the parser.
 *   - The autorización parser extracts the embedded `<comprobante>`
 *     element. SRI wraps it in `<![CDATA[...]]>`; xmldom delivers the
 *     decoded contents as the element's text — we read `textContent`.
 *   - Throws a `SriClientError(kind: 'parse')` when the XML is
 *     malformed or when neither RECIBIDA/DEVUELTA nor a recognised
 *     autorización estado is present.
 *
 * Never log the raw XML body. Callers may pass the parsed result to
 * the lifecycle layer which logs only mensaje identifiers + tipos.
 */
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import type { SriMensaje } from "@facturador/contracts/sri";
import { SriClientError } from "./errors.js";

/**
 * Mensaje 43 — "CLAVE ACCESO REGISTRADA". When SRI returns a DEVUELTA
 * with this identifier alone, the document was already received in a
 * previous attempt and should be treated as RECIBIDA (idempotent).
 * Source: docs §14 (mensajes).
 */
export const MENSAJE_CLAVE_ACCESO_REGISTRADA = "43";

/**
 * Recepción estado as parsed from the wire. The two domain states are
 * RECIBIDA and DEVUELTA; the special mensaje-43 reclassification is
 * applied here so the consumer never has to re-check.
 */
export type RecepcionEstadoParsed = "RECIBIDA" | "DEVUELTA";

export interface RecepcionParseResult {
  readonly estado: RecepcionEstadoParsed;
  readonly claveAcceso?: string;
  readonly mensajes: readonly SriMensaje[];
  /**
   * `true` when the wire said DEVUELTA but the only mensaje was id 43.
   * Exposed so the client can log `idempotent_recepcion` rather than
   * "DEVUELTA reclassified".
   */
  readonly reclassifiedFromDevuelta: boolean;
}

/**
 * Autorización estado normalised per docs §13 mapping. The "DESCONOCIDO"
 * fallback covers responses where SRI replied 200 but the inner estado
 * was empty (rare, but documented as a transient race).
 */
export type AutorizacionEstadoParsed =
  | "AUTORIZADO"
  | "NO_AUTORIZADO"
  | "EN_PROCESO"
  | "DESCONOCIDO";

export interface AutorizacionParseResult {
  readonly estado: AutorizacionEstadoParsed;
  readonly numeroAutorizacion?: string;
  readonly fechaAutorizacion?: string;
  readonly ambiente: "PRODUCCION" | "PRUEBAS" | "DESCONOCIDO";
  /** Extracted from the inner `<comprobante>` CDATA when AUTORIZADO. */
  readonly autorizadoXml?: string;
  readonly mensajes: readonly SriMensaje[];
}

/* -------------------------------------------------------------------------- */
/* Shared parse helpers                                                       */
/* -------------------------------------------------------------------------- */

function parseDocument(xml: string): Document {
  // xmldom's parseFromString emits warnings via an `errorHandler` callback.
  // We collect "error" / "fatalError" callbacks and throw a typed error so
  // the retry wrapper sees `kind: 'parse'` and does NOT retry (parse
  // failures are not transient — the body is bad and re-asking won't help).
  let fatal: string | null = null;
  const handler = {
    warning() {
      // ignore
    },
    error(msg: string) {
      fatal ??= msg;
    },
    fatalError(msg: string) {
      fatal = msg;
    },
  };
  const doc = new DOMParser({ errorHandler: handler }).parseFromString(xml, "text/xml");
  if (fatal !== null || doc.documentElement === null) {
    throw new SriClientError(`SRI returned malformed XML: ${fatal ?? "no root element"}`, {
      kind: "parse",
      transient: false,
    });
  }
  return doc as unknown as Document;
}

function selectNodes(doc: Node, expr: string): Node[] {
  return xpath.select(expr, doc as never) as Node[];
}

function selectFirstText(doc: Node, expr: string): string | undefined {
  const nodes = xpath.select(`${expr}/text()`, doc as never) as Array<{
    data?: string;
    toString: () => string;
  }>;
  if (nodes.length === 0) return undefined;
  const first = nodes[0];
  if (first === undefined) return undefined;
  const value = typeof first.data === "string" ? first.data : first.toString();
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Walk into a mensaje DOM node and extract the canonical {SriMensaje} shape.
 * Per docs §14 the four fields are `identificador`, `mensaje`,
 * `informacionAdicional` (optional), `tipo`.
 *
 * Defensive defaults:
 *   - identificador defaults to `""`. The Zod schema rejects empty
 *     strings, so we coerce to `unknown` here and let the SriMensaje
 *     consumer decide whether to reject. (In practice SRI always sends
 *     an identifier.)
 *   - tipo defaults to "INFORMATIVO" — that's the harmless choice.
 */
function readMensaje(node: Node): SriMensaje {
  const identificador = selectFirstText(node, `./*[local-name()='identificador']`) ?? "";
  const mensaje = selectFirstText(node, `./*[local-name()='mensaje']`) ?? "";
  const informacionAdicional = selectFirstText(node, `./*[local-name()='informacionAdicional']`);
  const tipoRaw = (
    selectFirstText(node, `./*[local-name()='tipo']`) ?? "INFORMATIVO"
  ).toUpperCase();
  const tipo =
    tipoRaw === "ERROR" || tipoRaw === "ADVERTENCIA" || tipoRaw === "INFORMATIVO"
      ? (tipoRaw as SriMensaje["tipo"])
      : ("INFORMATIVO" satisfies SriMensaje["tipo"]);
  return informacionAdicional === undefined
    ? { identificador, mensaje, tipo }
    : { identificador, mensaje, tipo, informacionAdicional };
}

/* -------------------------------------------------------------------------- */
/* Recepción                                                                  */
/* -------------------------------------------------------------------------- */

export function parseRecepcionResponse(xml: string): RecepcionParseResult {
  const doc = parseDocument(xml);

  // The `estado` may live either at `RespuestaRecepcionComprobante/estado`
  // or any nested location depending on SRI namespace drift. We anchor
  // on the response root by local-name and then descend.
  const estadoRaw = (
    selectFirstText(
      doc,
      `//*[local-name()='RespuestaRecepcionComprobante']/*[local-name()='estado']`,
    ) ??
    selectFirstText(doc, `//*[local-name()='estado']`) ??
    ""
  )
    .trim()
    .toUpperCase();

  if (estadoRaw !== "RECIBIDA" && estadoRaw !== "DEVUELTA") {
    throw new SriClientError(`Unrecognised recepción estado: '${estadoRaw}'`, {
      kind: "parse",
      transient: false,
    });
  }

  const claveAcceso = selectFirstText(
    doc,
    `//*[local-name()='comprobante']/*[local-name()='claveAcceso']`,
  );

  const mensajeNodes = selectNodes(doc, `//*[local-name()='mensajes']/*[local-name()='mensaje']`);
  const mensajes = mensajeNodes.map(readMensaje);

  let estado: RecepcionEstadoParsed = estadoRaw;
  let reclassifiedFromDevuelta = false;

  // Mensaje 43 ⇒ idempotent: clave already registered ⇒ treat as RECIBIDA.
  if (
    estado === "DEVUELTA" &&
    mensajes.length > 0 &&
    mensajes.every((m) => m.identificador === MENSAJE_CLAVE_ACCESO_REGISTRADA)
  ) {
    estado = "RECIBIDA";
    reclassifiedFromDevuelta = true;
  }

  return claveAcceso === undefined
    ? { estado, mensajes, reclassifiedFromDevuelta }
    : { estado, claveAcceso, mensajes, reclassifiedFromDevuelta };
}

/* -------------------------------------------------------------------------- */
/* Autorización                                                               */
/* -------------------------------------------------------------------------- */

export function parseAutorizacionResponse(xml: string): AutorizacionParseResult {
  const doc = parseDocument(xml);

  const autorizacionNode =
    selectNodes(
      doc,
      `//*[local-name()='RespuestaAutorizacionComprobante']//*[local-name()='autorizacion']`,
    )[0] ?? selectNodes(doc, `//*[local-name()='autorizacion']`)[0];

  if (autorizacionNode === undefined) {
    throw new SriClientError("Autorización response missing <autorizacion> node", {
      kind: "parse",
      transient: false,
    });
  }

  const estadoRaw = (selectFirstText(autorizacionNode, `./*[local-name()='estado']`) ?? "")
    .trim()
    .toUpperCase();

  const estado = normaliseAutorizacionEstado(estadoRaw);

  const ambienteRaw = (selectFirstText(autorizacionNode, `./*[local-name()='ambiente']`) ?? "")
    .trim()
    .toUpperCase();
  const ambiente: AutorizacionParseResult["ambiente"] =
    ambienteRaw === "PRODUCCION" || ambienteRaw === "PRODUCCIÓN"
      ? "PRODUCCION"
      : ambienteRaw === "PRUEBAS"
        ? "PRUEBAS"
        : "DESCONOCIDO";

  const numeroAutorizacion = selectFirstText(
    autorizacionNode,
    `./*[local-name()='numeroAutorizacion']`,
  );
  const fechaAutorizacion = selectFirstText(
    autorizacionNode,
    `./*[local-name()='fechaAutorizacion']`,
  );

  const mensajeNodes = selectNodes(
    autorizacionNode,
    `.//*[local-name()='mensajes']/*[local-name()='mensaje']`,
  );
  const mensajes = mensajeNodes.map(readMensaje);

  // Extract the embedded XML. We grab textContent of `<comprobante>` —
  // CDATA contents come through as text per the XML spec.
  let autorizadoXml: string | undefined;
  if (estado === "AUTORIZADO") {
    const comprobanteNodes = selectNodes(autorizacionNode, `./*[local-name()='comprobante']`);
    const comprobanteNode = comprobanteNodes[0];
    if (comprobanteNode !== undefined) {
      // xmldom's Node has `textContent` available on Element nodes.
      const text = (comprobanteNode as unknown as { textContent: string | null }).textContent;
      if (text !== null && text.trim() !== "") {
        autorizadoXml = text.trim();
      }
    }
  }

  return {
    estado,
    ambiente,
    mensajes,
    ...(numeroAutorizacion === undefined ? {} : { numeroAutorizacion }),
    ...(fechaAutorizacion === undefined ? {} : { fechaAutorizacion }),
    ...(autorizadoXml === undefined ? {} : { autorizadoXml }),
  };
}

/**
 * Normalise the estado per docs §13. Accepts the spaced ("EN PROCESO")
 * and underscored variants and falls back to DESCONOCIDO when SRI
 * sends an empty/unknown value.
 */
export function normaliseAutorizacionEstado(value: string): AutorizacionEstadoParsed {
  const v = value.trim().toUpperCase();
  if (v === "AUTORIZADO") return "AUTORIZADO";
  if (v === "NO AUTORIZADO" || v === "NO_AUTORIZADO" || v === "RECHAZADA") return "NO_AUTORIZADO";
  if (v === "EN PROCESO" || v === "EN_PROCESO") return "EN_PROCESO";
  return "DESCONOCIDO";
}
