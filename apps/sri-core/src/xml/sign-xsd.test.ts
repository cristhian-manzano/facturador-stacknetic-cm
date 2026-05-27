/**
 * Integration test: the signed factura still validates against the SRI
 * XSD with the optional `ds:Signature` slot populated (TASKS-0024 §4
 * implicit invariant; PROMPT-0024 finishing-line: "Signed output is
 * well-formed XML and validates against the SRI XSD with the additional
 * Signature element").
 *
 * The validator is the same `xmllint-wasm` pipeline used by the build
 * step, with the `xmldsig-core-schema.xsd` preloaded so the
 * `xs:import namespace="http://www.w3.org/2000/09/xmldsig#"` resolves
 * without a network call.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { makeTestCert } from "../../test/fixtures/test-keypair.js";

import { buildFacturaXml } from "./factura.js";
import { signFacturaXml } from "./sign.js";
import { validateAgainstXsd } from "./validate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadInput(): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "..", "..", "test", "fixtures", "factura", "golden-01.input.json"),
      "utf8",
    ),
  ) as unknown;
}

describe("XSD validation — signed factura", () => {
  it("the signed XML still validates against factura_V2.1.0.xsd", async () => {
    const { xmlForSigning } = buildFacturaXml(loadInput());
    const cert = makeTestCert();
    const { signedXml } = await signFacturaXml({
      xmlForSigning,
      certificate: { certPem: cert.certPem, keyPem: cert.keyPem },
    });
    const result = await validateAgainstXsd(signedXml);
    if (!result.valid) {
      // Surface the errors via toEqual so vitest prints them on failure.
      // We don't `.toContain('<factura>')` because the assertion message
      // already gives us enough information.
      expect(result.errors).toEqual([]);
    }
    expect(result.valid).toBe(true);
  });
});
