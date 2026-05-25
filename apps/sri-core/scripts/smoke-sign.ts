/**
 * Smoke runner for the XAdES-BES signer (PROMPT-0024 finishing-line:
 * "a node script signs the factura from PROMPT-0023's golden fixture and
 * dumps the result to stdout").
 *
 * Generates a fresh synthetic RSA cert in memory (never written to disk),
 * builds the factura from the golden fixture, signs it, runs local
 * verification, and prints the signed XML to stdout. Failures abort
 * with exit code 1 — useful for shell-based finishing-line checks.
 *
 * Usage:
 *   pnpm --filter @facturador/sri-core exec tsx scripts/smoke-sign.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { buildFacturaXml } from "../src/xml/factura.js";
import { signFacturaXml } from "../src/xml/sign.js";
import { verifySignedXml } from "../src/xml/verify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeTestCert(): { certPem: string; keyPem: string } {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(privatePem);
  const forgePublicKey = forge.pki.rsa.setPublicKey(forgeKey.n, forgeKey.e);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = "0123456789abcdef";
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 1000);
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 3_600_000);
  cert.setSubject([{ shortName: "CN", value: "Smoke Subject" }]);
  cert.setIssuer([{ shortName: "CN", value: "Smoke Issuer" }]);
  cert.sign(forgeKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(forgeKey),
  };
}

async function main(): Promise<void> {
  const inputPath = path.resolve(
    __dirname,
    "..",
    "test",
    "fixtures",
    "factura",
    "golden-01.input.json",
  );
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as unknown;
  const { xmlForSigning } = buildFacturaXml(input);

  const { certPem, keyPem } = makeTestCert();
  const algoFromEnv = (process.env.SRI_SIGN_ALGO ?? "SHA1") as "SHA1" | "SHA256";

  const { signedXml, algo } = await signFacturaXml({
    xmlForSigning,
    certificate: { certPem, keyPem },
    algo: algoFromEnv,
  });

  process.stdout.write(`<?xml version="1.0" encoding="UTF-8"?>${signedXml}\n`);

  const verify = await verifySignedXml(signedXml);
  process.stderr.write(
    `Verify: ${verify.valid ? "OK" : "FAIL"} algo=${algo} bytes=${String(signedXml.length)}\n`,
  );
  if (!verify.valid) {
    for (const e of verify.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[smoke-sign] failed: ${message}\n`);
  process.exit(1);
});
