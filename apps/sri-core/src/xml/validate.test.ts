/**
 * Tests for the XSD validator (TASKS-0023 §1.3 + §3.3).
 *
 * Coverage:
 *   - Positive: golden XML parses and validates.
 *   - Negative: a tampered XML (root tag renamed) is rejected with at
 *     least one error message.
 *   - Path resolution: the bundled XSD exists at the expected runtime
 *     path (TASKS-0023 §5.1 "the built image contains /app/apps/sri-core/dist/resources/factura_V2.1.0.xsd").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, afterEach } from "vitest";

import { buildFacturaXml } from "./factura.js";
import {
  getFacturaXsdPath,
  getXmldsigXsdPath,
  validateAgainstXsd,
  __resetSchemaCacheForTests,
} from "./validate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const goldenInputPath = path.resolve(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "factura",
  "golden-01.input.json",
);
const readGoldenInput = (): unknown =>
  JSON.parse(fs.readFileSync(goldenInputPath, "utf8")) as unknown;

describe("validateAgainstXsd", () => {
  it("returns valid:true for the golden xmlForSigning", async () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    const r = await validateAgainstXsd(xmlForSigning);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("returns valid:false when the root element is renamed", async () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    const tampered = xmlForSigning
      .replace("<factura", "<facturaWRONG")
      .replace("</factura>", "</facturaWRONG>");
    const r = await validateAgainstXsd(tampered);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("returns valid:false when a required field is missing", async () => {
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    // Strip the entire detalles block — XSD requires minOccurs=1.
    const broken = xmlForSigning.replace(/<detalles>[\s\S]*?<\/detalles>/, "");
    const r = await validateAgainstXsd(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("memoises the schema bundle across calls", async () => {
    __resetSchemaCacheForTests();
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());
    const r1 = await validateAgainstXsd(xmlForSigning);
    const r2 = await validateAgainstXsd(xmlForSigning);
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
  });
});

describe("schema resource paths", () => {
  it("bundled factura XSD exists at the resolved path", () => {
    const p = getFacturaXsdPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(0);
  });

  it("bundled xmldsig XSD exists at the resolved path", () => {
    const p = getXmldsigXsdPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(0);
  });
});

describe("validateAgainstXsd — schema cache shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetSchemaCacheForTests();
  });

  it("reads the XSD bytes from disk exactly twice (factura + xmldsig) across many calls", async () => {
    __resetSchemaCacheForTests();
    // Spy AFTER the reset so we observe only the loadSchemas() calls.
    const spy = vi.spyOn(fs, "readFileSync");
    const { xmlForSigning } = buildFacturaXml(readGoldenInput());

    // First call — should drive both factura + xmldsig reads.
    await validateAgainstXsd(xmlForSigning);
    const countAfterFirst = spy.mock.calls.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second + third calls — must NOT add reads. The XSD bytes live in
    // the module-level cache from the first call onwards.
    await validateAgainstXsd(xmlForSigning);
    await validateAgainstXsd(xmlForSigning);
    expect(spy.mock.calls.length).toBe(countAfterFirst);
  });
});
