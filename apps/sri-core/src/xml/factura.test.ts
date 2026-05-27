/**
 * Tests for the factura XML builder (TASKS-0023 §3 + §4 + §6).
 *
 * What this suite covers:
 *   - Phase 3.1: Golden-file byte equality (deterministic build).
 *   - Phase 3.2: XSD validation of the same xmlForSigning.
 *   - Phase 4.1: descripcion sanitisation (newline → space; still XSD-valid).
 *   - Phase 4.2: descripcion 300-char cap (input length 500).
 *   - Phase 4.3: missing-field path throws `MISSING_FIELD` with a path.
 *   - Phase 4.4: unsupported IVA `codigoPorcentaje` throws `INVALID_TAX_CODE`.
 *   - Bonus: deterministic build (same input → byte-identical output).
 *   - Bonus: accented characters survive end-to-end (`áéíóúñÑ`).
 *   - Bonus: numeric rounding (toFixed(2) / toFixed(6)).
 *
 * Why we keep both a `test/golden/factura-golden-01.xml` AND a
 * `test/fixtures/factura/golden-01.xml`: the prompt mandates the
 * former path explicitly while TASKS-0023 §3.1 names the latter. The
 * test asserts both files have the same bytes (they are copies) — this
 * keeps either consumer happy without forking the truth.
 *
 * The test inputs are typed loosely (`Record<string, unknown>`) because
 * the schema brands several primitives (`ClaveAcceso`, `Estab`, …) and
 * minting them by hand would obscure the test intent. We round-trip
 * through `parse` inside the builder; tests stay readable. Several
 * `unknown`-cast chains carry a tiny eslint-disable to silence the
 * non-null-assertion rule on freshly cloned fixtures where the
 * property is definitionally present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { buildFacturaXml, XmlBuildError } from "./factura.js";
import { cleanDescripcion } from "./sanitise.js";
import { validateAgainstXsd } from "./validate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..", "..");

const goldenInputPath = path.join(PKG_ROOT, "test", "fixtures", "factura", "golden-01.input.json");
const goldenXmlPath = path.join(PKG_ROOT, "test", "golden", "factura-golden-01.xml");
const goldenXmlFixturePath = path.join(PKG_ROOT, "test", "fixtures", "factura", "golden-01.xml");

type AnyObj = Record<string, unknown>;
type AnyArr = AnyObj[];

const readGoldenInput = (): AnyObj =>
  JSON.parse(fs.readFileSync(goldenInputPath, "utf8")) as AnyObj;

const readGoldenXml = (): string => fs.readFileSync(goldenXmlPath, "utf8");

const cloneInput = (): AnyObj => JSON.parse(JSON.stringify(readGoldenInput())) as AnyObj;

/** Helpers that return a typed view of nested mutable fixture pieces. */
const detalles = (input: AnyObj): AnyArr => input.detalles as AnyArr;
const detalle0 = (input: AnyObj): AnyObj => {
  const d = detalles(input)[0];
  if (!d) throw new Error("fixture missing detalles[0]");
  return d;
};
const detalle0Impuesto0 = (input: AnyObj): AnyObj => {
  const d = detalle0(input);
  const imp = (d.impuestos as AnyArr)[0];
  if (!imp) throw new Error("fixture missing impuestos[0]");
  return imp;
};
const infoTributaria = (input: AnyObj): AnyObj => input.infoTributaria as AnyObj;
const infoFactura = (input: AnyObj): AnyObj => input.infoFactura as AnyObj;
const totalImpuesto0 = (input: AnyObj): AnyObj => {
  const arr = infoFactura(input).totalConImpuestos as AnyArr;
  const ti = arr[0];
  if (!ti) throw new Error("fixture missing totalConImpuestos[0]");
  return ti;
};
const pago0 = (input: AnyObj): AnyObj => {
  const arr = infoFactura(input).pagos as AnyArr;
  const p = arr[0];
  if (!p) throw new Error("fixture missing pagos[0]");
  return p;
};

describe("buildFacturaXml — happy path", () => {
  it('root is <factura id="comprobante" version="2.1.0">', () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    expect(xmlForSigning.startsWith('<factura id="comprobante" version="2.1.0">')).toBe(true);
  });

  it("xml starts with the UTF-8 declaration", () => {
    const { xml } = buildFacturaXml(readGoldenInput());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("xmlForSigning does NOT include the XML declaration", () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    expect(xmlForSigning.startsWith("<?xml")).toBe(false);
    expect(xmlForSigning.startsWith("<factura")).toBe(true);
  });

  it("matches the checked-in golden bytes exactly", () => {
    const { xml } = buildFacturaXml(readGoldenInput());
    expect(xml).toBe(readGoldenXml());
  });

  it("keeps the fixtures and golden copies in sync", () => {
    expect(fs.readFileSync(goldenXmlPath, "utf8")).toBe(
      fs.readFileSync(goldenXmlFixturePath, "utf8"),
    );
  });

  it("is deterministic — same input twice yields byte-identical output", () => {
    const a = buildFacturaXml(readGoldenInput()).xml;
    const b = buildFacturaXml(readGoldenInput()).xml;
    expect(a).toBe(b);
  });

  it("validates against the bundled SRI XSD", async () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    const result = await validateAgainstXsd(xmlForSigning);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("preserves accented Spanish characters in output", () => {
    const { xml } = buildFacturaXml(readGoldenInput());
    expect(xml).toContain("Pérez Ñandú");
  });
});

describe("buildFacturaXml — sanitisation", () => {
  it("collapses newline-laden descripcion into single-line XML", async () => {
    const input = cloneInput();
    detalle0(input).descripcion = "Servicio\nlínea 2\ttabulado";
    const { xml, xmlForSigning } = buildFacturaXml(input);
    expect(xml).toContain("<descripcion>Servicio línea 2 tabulado</descripcion>");
    const result = await validateAgainstXsd(xmlForSigning);
    expect(result.valid).toBe(true);
  });

  it("truncates descripcion to 300 chars", () => {
    const input = cloneInput();
    const longDesc = "x".repeat(500);
    detalle0(input).descripcion = longDesc;
    const { xml } = buildFacturaXml(input);
    const match = /<descripcion>([\s\S]*?)<\/descripcion>/.exec(xml);
    expect(match).not.toBeNull();
    const captured = match?.[1] ?? "";
    expect(captured.length).toBe(300);
    expect(captured).toBe(cleanDescripcion(longDesc));
  });

  it("escapes XML-special characters in razonSocialComprador", () => {
    const input = cloneInput();
    infoFactura(input).razonSocialComprador = "A & B <S.A.>";
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<razonSocialComprador>A &amp; B &lt;S.A.&gt;</razonSocialComprador>");
  });
});

describe("buildFacturaXml — numeric formatting", () => {
  it("formats money fields to exactly 2 decimals", () => {
    const input = cloneInput();
    infoFactura(input).importeTotal = 115;
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<importeTotal>115.00</importeTotal>");
  });

  it("formats cantidad and precioUnitario to exactly 6 decimals", () => {
    const input = cloneInput();
    detalle0(input).cantidad = 1.5;
    detalle0(input).precioUnitario = 33.333333;
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<cantidad>1.500000</cantidad>");
    expect(xml).toContain("<precioUnitario>33.333333</precioUnitario>");
  });

  it("renders 0 with the proper trailing decimals (not '-0.00')", () => {
    const input = cloneInput();
    detalle0(input).descuento = 0;
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<descuento>0.00</descuento>");
    expect(xml).not.toContain("-0.00");
  });
});

describe("buildFacturaXml — optional element coverage", () => {
  it("omits optional fields when absent", () => {
    const input = cloneInput();
    delete infoTributaria(input).nombreComercial;
    delete infoFactura(input).dirEstablecimiento;
    delete infoFactura(input).obligadoContabilidad;
    delete infoFactura(input).direccionComprador;
    delete infoFactura(input).moneda;
    delete input.infoAdicional;
    const { xml } = buildFacturaXml(input);
    expect(xml).not.toContain("<nombreComercial");
    expect(xml).not.toContain("<dirEstablecimiento");
    expect(xml).not.toContain("<obligadoContabilidad");
    expect(xml).not.toContain("<direccionComprador");
    expect(xml).not.toContain("<moneda");
    expect(xml).not.toContain("<infoAdicional");
  });

  it("emits optional pago.plazo / unidadTiempo / propina / totalImpuesto extras", () => {
    const input = cloneInput();
    infoFactura(input).propina = 1.5;
    const ti = totalImpuesto0(input);
    ti.descuentoAdicional = 0.25;
    ti.valorDevolucionIva = 0;
    const p = pago0(input);
    p.plazo = 30;
    p.unidadTiempo = "días";
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<propina>1.50</propina>");
    expect(xml).toContain("<descuentoAdicional>0.25</descuentoAdicional>");
    expect(xml).toContain("<valorDevolucionIva>0.00</valorDevolucionIva>");
    expect(xml).toContain("<plazo>30.00</plazo>");
    expect(xml).toContain("<unidadTiempo>días</unidadTiempo>");
  });

  it("emits detalle.detallesAdicionales when provided", () => {
    const input = cloneInput();
    const det = detalle0(input);
    det.detallesAdicionales = [
      { nombre: "Color", valor: "Rojo" },
      { nombre: "Marca", valor: "Acme & Co" },
    ];
    det.codigoAuxiliar = "AUX-01";
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<codigoAuxiliar>AUX-01</codigoAuxiliar>");
    expect(xml).toContain('<detAdicional nombre="Color" valor="Rojo"/>');
    expect(xml).toContain('<detAdicional nombre="Marca" valor="Acme &amp; Co"/>');
  });

  it("accepts optional infoTributaria.agenteRetencion + contribuyenteRimpe", () => {
    const input = cloneInput();
    infoTributaria(input).agenteRetencion = "1234";
    infoTributaria(input).contribuyenteRimpe = "CONTRIBUYENTE RÉGIMEN RIMPE";
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<agenteRetencion>1234</agenteRetencion>");
    expect(xml).toContain("<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>");
  });

  it("accepts optional infoFactura.contribuyenteEspecial + guiaRemision", () => {
    const input = cloneInput();
    infoFactura(input).contribuyenteEspecial = "1234A";
    infoFactura(input).guiaRemision = "001-001-000000123";
    const { xml } = buildFacturaXml(input);
    expect(xml).toContain("<contribuyenteEspecial>1234A</contribuyenteEspecial>");
    expect(xml).toContain("<guiaRemision>001-001-000000123</guiaRemision>");
  });
});

describe("buildFacturaXml — negative inputs", () => {
  it("throws MISSING_FIELD when infoTributaria.ambiente is missing", () => {
    const input = cloneInput();
    delete infoTributaria(input).ambiente;
    try {
      buildFacturaXml(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(XmlBuildError);
      const e = err as XmlBuildError;
      expect(e.code).toBe("MISSING_FIELD");
      expect(e.path).toBe("infoTributaria.ambiente");
    }
  });

  it("throws INVALID_TAX_CODE for unsupported IVA codigoPorcentaje", () => {
    const input = cloneInput();
    detalle0Impuesto0(input).codigoPorcentaje = "9";
    try {
      buildFacturaXml(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(XmlBuildError);
      const e = err as XmlBuildError;
      expect(e.code).toBe("INVALID_TAX_CODE");
      expect(e.path).toContain("codigoPorcentaje");
    }
  });

  it("throws INVALID_INPUT when claveAcceso checksum is wrong", () => {
    const input = cloneInput();
    infoTributaria(input).claveAcceso = "1905202601999000001500110010010000000011234567812";
    try {
      buildFacturaXml(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(XmlBuildError);
      const e = err as XmlBuildError;
      expect(e.code).toBe("INVALID_INPUT");
      expect(e.path).toBe("infoTributaria.claveAcceso");
    }
  });
});
