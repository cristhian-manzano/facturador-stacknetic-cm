/**
 * Tests for `parseRecepcionResponse` + `parseAutorizacionResponse`.
 *
 * Asserts:
 *   - RECIBIDA fixture parses to estado RECIBIDA, mensajes = [].
 *   - DEVUELTA fixture with two mensajes parses both in order with
 *     tipo === "ERROR" / "INFORMATIVO" preserved.
 *   - Mensaje 43 on DEVUELTA → reclassified to RECIBIDA, flag set.
 *   - Mensaje 70 (non-43) DEVUELTA → estado stays DEVUELTA.
 *   - Autorización AUTORIZADO: numeroAutorizacion + fechaAutorizacion
 *     extracted; `autorizadoXml` byte-equals the embedded comprobante.
 *   - Autorización EN_PROCESO → estado EN_PROCESO, no autorizadoXml.
 *   - Autorización NO_AUTORIZADO → estado NO_AUTORIZADO, mensajes parsed.
 *   - Malformed XML throws an `SriClientError(kind: 'parse')`.
 *
 * Source of truth:
 *   - SPEC-0025 §AC-1, §AC-2, §AC-3.
 *   - PLAN-0025 §4 Phase 3.
 *   - TASKS-0025 §3 validation block.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SriClientError } from "./errors.js";
import {
  parseRecepcionResponse,
  parseAutorizacionResponse,
  MENSAJE_CLAVE_ACCESO_REGISTRADA,
  normaliseAutorizacionEstado,
} from "./parse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, "..", "..", "test", "fixtures", "soap");

const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseRecepcionResponse", () => {
  it("returns RECIBIDA when SRI accepts the comprobante", () => {
    const out = parseRecepcionResponse(read("recepcion-recibida.xml"));
    expect(out.estado).toBe("RECIBIDA");
    expect(out.mensajes).toEqual([]);
    expect(out.reclassifiedFromDevuelta).toBe(false);
  });

  it("returns DEVUELTA with both mensajes preserving order + tipo", () => {
    const out = parseRecepcionResponse(read("recepcion-devuelta.xml"));
    expect(out.estado).toBe("DEVUELTA");
    expect(out.reclassifiedFromDevuelta).toBe(false);
    expect(out.mensajes).toHaveLength(2);
    expect(out.mensajes[0]).toEqual({
      identificador: "35",
      mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      informacionAdicional: "Estructura XML invalida",
      tipo: "ERROR",
    });
    expect(out.mensajes[1]?.identificador).toBe("50");
    expect(out.mensajes[1]?.tipo).toBe("ERROR");
  });

  it("reclassifies mensaje 43 DEVUELTA into RECIBIDA (idempotent re-send)", () => {
    const out = parseRecepcionResponse(read("recepcion-devuelta-43.xml"));
    expect(out.estado).toBe("RECIBIDA");
    expect(out.reclassifiedFromDevuelta).toBe(true);
    expect(out.mensajes).toHaveLength(1);
    expect(out.mensajes[0]?.identificador).toBe(MENSAJE_CLAVE_ACCESO_REGISTRADA);
  });

  it("keeps DEVUELTA when mensaje 70 (non-43) error is present", () => {
    const out = parseRecepcionResponse(read("recepcion-devuelta-70.xml"));
    expect(out.estado).toBe("DEVUELTA");
    expect(out.reclassifiedFromDevuelta).toBe(false);
    expect(out.mensajes.map((m) => m.identificador)).toEqual(["70", "50"]);
    expect(out.mensajes.map((m) => m.tipo)).toEqual(["ERROR", "INFORMATIVO"]);
  });

  it("throws SriClientError(parse) on malformed XML", () => {
    expect(() => parseRecepcionResponse("not xml")).toThrow(SriClientError);
  });

  it("throws SriClientError(parse) on unrecognised estado", () => {
    const xml = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
            <RespuestaRecepcionComprobante><estado>RARO</estado></RespuestaRecepcionComprobante>
          </ns2:validarComprobanteResponse>
        </soap:Body>
      </soap:Envelope>`;
    expect(() => parseRecepcionResponse(xml)).toThrow(/Unrecognised/);
  });
});

describe("parseAutorizacionResponse", () => {
  it("parses AUTORIZADO with numeroAutorizacion + fechaAutorizacion + autorizadoXml", () => {
    const out = parseAutorizacionResponse(read("autorizacion-autorizado.xml"));
    expect(out.estado).toBe("AUTORIZADO");
    expect(out.ambiente).toBe("PRODUCCION");
    expect(out.numeroAutorizacion).toBe("1234567890123456789012345678901234567890123456789");
    expect(out.fechaAutorizacion).toBe("2026-05-19T10:34:21-05:00");
    expect(out.autorizadoXml).toBeDefined();
    // Spot-check the inner comprobante was extracted from CDATA.
    expect(out.autorizadoXml).toContain("<factura");
    expect(out.autorizadoXml).toContain('id="comprobante"');
    expect(out.autorizadoXml).toContain("ACME");
    expect(out.mensajes).toEqual([]);
  });

  it("parses EN PROCESO autorización (spaced variant maps to EN_PROCESO)", () => {
    const out = parseAutorizacionResponse(read("autorizacion-en-proceso.xml"));
    expect(out.estado).toBe("EN_PROCESO");
    expect(out.ambiente).toBe("PRUEBAS");
    expect(out.autorizadoXml).toBeUndefined();
    expect(out.mensajes).toEqual([]);
  });

  it("parses NO AUTORIZADO with a mensaje preserving identificador + tipo", () => {
    const out = parseAutorizacionResponse(read("autorizacion-no-autorizado.xml"));
    expect(out.estado).toBe("NO_AUTORIZADO");
    expect(out.ambiente).toBe("PRODUCCION");
    expect(out.mensajes).toHaveLength(1);
    expect(out.mensajes[0]?.identificador).toBe("39");
    expect(out.mensajes[0]?.tipo).toBe("ERROR");
  });

  it("throws SriClientError when <autorizacion> is missing", () => {
    const xml = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body><RespuestaAutorizacionComprobante/></soap:Body>
      </soap:Envelope>`;
    expect(() => parseAutorizacionResponse(xml)).toThrow(/missing/);
  });

  it("extracts the inner <factura> when SRI ships it inline (no CDATA wrapper)", () => {
    // Defensive: some SRI test boxes have been observed shipping the
    // inner factura as an inline element. `textContent` returns "" in
    // that case — we must serialise the first element child instead.
    const out = parseAutorizacionResponse(read("autorizacion-autorizado-inline.xml"));
    expect(out.estado).toBe("AUTORIZADO");
    expect(out.ambiente).toBe("PRUEBAS");
    expect(out.autorizadoXml).toBeDefined();
    expect(out.autorizadoXml).toContain("<factura");
    expect(out.autorizadoXml).toContain('id="comprobante"');
    expect(out.autorizadoXml).toContain("ACME-INLINE");
  });
});

describe("normaliseAutorizacionEstado", () => {
  it("maps every documented variant", () => {
    expect(normaliseAutorizacionEstado("AUTORIZADO")).toBe("AUTORIZADO");
    expect(normaliseAutorizacionEstado("NO AUTORIZADO")).toBe("NO_AUTORIZADO");
    expect(normaliseAutorizacionEstado("NO_AUTORIZADO")).toBe("NO_AUTORIZADO");
    expect(normaliseAutorizacionEstado("RECHAZADA")).toBe("NO_AUTORIZADO");
    expect(normaliseAutorizacionEstado("EN PROCESO")).toBe("EN_PROCESO");
    expect(normaliseAutorizacionEstado("EN_PROCESO")).toBe("EN_PROCESO");
    expect(normaliseAutorizacionEstado("")).toBe("DESCONOCIDO");
    expect(normaliseAutorizacionEstado("WAT")).toBe("DESCONOCIDO");
  });
});
