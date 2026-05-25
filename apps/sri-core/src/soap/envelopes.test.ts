/**
 * Tests for `buildRecepcionEnvelope` + `buildAutorizacionEnvelope`.
 *
 * Asserts:
 *   - Byte-for-byte equality with golden fixtures under
 *     `test/fixtures/soap/*-envelope.golden.xml`. If the bytes ever
 *     drift, downstream signing assumptions break — so this test must
 *     fail on any whitespace / namespace / attribute-order change.
 *   - Defensive input validation: non-base64 chars are rejected for
 *     recepción, non-49-digit input for autorización.
 *
 * Source of truth:
 *   - SPEC-0025 §6.3 envelopes.
 *   - TASKS-0025 §2 validation step.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAutorizacionEnvelope,
  buildRecepcionEnvelope,
  RECEPCION_NAMESPACE,
  AUTORIZACION_NAMESPACE,
} from "./envelopes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, "..", "..", "test", "fixtures", "soap");

describe("buildRecepcionEnvelope", () => {
  it("produces byte-equal output against the golden fixture", () => {
    const golden = readFileSync(join(FIXTURES, "recepcion-envelope.golden.xml"), "utf8");
    // The golden contains base64 of "<signed></signed>" → PHNpZ25lZD48L3NpZ25lZD4=
    const out = buildRecepcionEnvelope({ signedXmlBase64: "PHNpZ25lZD48L3NpZ25lZD4=" });
    expect(out).toBe(golden);
  });

  it("rejects non-base64 input to prevent envelope injection", () => {
    expect(() => buildRecepcionEnvelope({ signedXmlBase64: "<not-base64>" })).toThrow(/non-base64/);
  });

  it("accepts whitespace-padded base64", () => {
    // Whitespace in the alphabet pattern is allowed — many encoders wrap.
    const out = buildRecepcionEnvelope({ signedXmlBase64: "PHNpZ25l ZD48L3NpZ25lZD4=" });
    // The envelope embeds the input verbatim — whitespace passes through.
    expect(out).toContain("PHNpZ25l ZD48L3NpZ25lZD4=");
  });

  it("includes the canonical recepción namespace", () => {
    expect(RECEPCION_NAMESPACE).toBe("http://ec.gob.sri.ws.recepcion");
    const out = buildRecepcionEnvelope({ signedXmlBase64: "PHNpZ25lZD48L3NpZ25lZD4=" });
    expect(out).toContain(`xmlns:ec="${RECEPCION_NAMESPACE}"`);
  });
});

describe("buildAutorizacionEnvelope", () => {
  it("produces byte-equal output against the golden fixture", () => {
    const golden = readFileSync(join(FIXTURES, "autorizacion-envelope.golden.xml"), "utf8");
    const out = buildAutorizacionEnvelope({
      claveAcceso: "1234567890123456789012345678901234567890123456789",
    });
    expect(out).toBe(golden);
  });

  it("rejects a clave-acceso of the wrong length", () => {
    expect(() => buildAutorizacionEnvelope({ claveAcceso: "1234567890" })).toThrow(/49 digits/);
  });

  it("rejects a clave-acceso with non-digit characters", () => {
    expect(() =>
      buildAutorizacionEnvelope({
        claveAcceso: "12345678901234567890123456789012345678901234567XX",
      }),
    ).toThrow(/49 digits/);
  });

  it("includes the canonical autorización namespace", () => {
    expect(AUTORIZACION_NAMESPACE).toBe("http://ec.gob.sri.ws.autorizacion");
    const out = buildAutorizacionEnvelope({
      claveAcceso: "1234567890123456789012345678901234567890123456789",
    });
    expect(out).toContain(`xmlns:ec="${AUTORIZACION_NAMESPACE}"`);
  });
});
