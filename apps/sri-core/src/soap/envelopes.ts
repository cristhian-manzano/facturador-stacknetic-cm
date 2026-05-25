/**
 * Hand-rolled SOAP envelope builders for SRI's two web services.
 *
 * The envelopes are tiny and stable; a SOAP library buys nothing here and
 * costs us code-execution surface, namespace surprises, and pretty-printing
 * that the SRI parsers historically choked on. We emit the exact bytes
 * documented in `docs/sri-facturacion-electronica-ecuador.md` §11.
 *
 * Both builders return a UTF-8 string (no trailing newline) that the
 * caller passes directly to `httpPostXml`. The strings are deterministic
 * — golden fixtures under `test/fixtures/soap/*.xml` lock the bytes.
 *
 * Source of truth:
 *   - SPEC-0025 §6.3 + §FR-1/FR-2.
 *   - docs/sri-facturacion-electronica-ecuador.md §11 envelopes.
 *   - TASKS-0025 §2 (envelopes).
 */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Namespace URIs are part of the SRI contract — they MUST match exactly. */
export const RECEPCION_NAMESPACE = "http://ec.gob.sri.ws.recepcion";
export const AUTORIZACION_NAMESPACE = "http://ec.gob.sri.ws.autorizacion";
export const SOAPENV_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";

export interface BuildRecepcionEnvelopeInput {
  /** Base64-encoded signed XML (per SRI: the `<xml>` element contains b64). */
  readonly signedXmlBase64: string;
}

export interface BuildAutorizacionEnvelopeInput {
  /** 49-digit access key — already validated by the caller (Zod upstream). */
  readonly claveAcceso: string;
}

/**
 * Build the SOAP envelope for `validarComprobante` (recepción).
 *
 * Byte layout (golden fixture):
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <soapenv:Envelope ...><soapenv:Header/><soapenv:Body>
 *     <ec:validarComprobante><xml>{base64}</xml></ec:validarComprobante>
 *   </soapenv:Body></soapenv:Envelope>
 */
export function buildRecepcionEnvelope(input: BuildRecepcionEnvelopeInput): string {
  // Base64 may contain `+`, `/`, `=` — none of those need XML escaping.
  // We still defend against malformed input by rejecting bytes outside
  // the base64 alphabet — protects the caller from a copy-paste bug
  // injecting `<` into the envelope.
  if (!/^[A-Za-z0-9+/=\s]*$/.test(input.signedXmlBase64)) {
    throw new Error("buildRecepcionEnvelope: signedXmlBase64 contains non-base64 bytes");
  }
  return (
    `${XML_DECLARATION}` +
    `<soapenv:Envelope xmlns:soapenv="${SOAPENV_NAMESPACE}" xmlns:ec="${RECEPCION_NAMESPACE}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<ec:validarComprobante>` +
    `<xml>${input.signedXmlBase64}</xml>` +
    `</ec:validarComprobante>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/**
 * Build the SOAP envelope for `autorizacionComprobante`.
 *
 * The claveAcceso is 49 ASCII digits — no escaping needed. We still defend:
 * the regex below rejects anything other than 49 digits to prevent an
 * injection if a caller skipped the Zod check upstream.
 */
export function buildAutorizacionEnvelope(input: BuildAutorizacionEnvelopeInput): string {
  if (!/^\d{49}$/.test(input.claveAcceso)) {
    throw new Error("buildAutorizacionEnvelope: claveAcceso must be 49 digits");
  }
  return (
    `${XML_DECLARATION}` +
    `<soapenv:Envelope xmlns:soapenv="${SOAPENV_NAMESPACE}" xmlns:ec="${AUTORIZACION_NAMESPACE}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<ec:autorizacionComprobante>` +
    `<claveAccesoComprobante>${input.claveAcceso}</claveAccesoComprobante>` +
    `</ec:autorizacionComprobante>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}
