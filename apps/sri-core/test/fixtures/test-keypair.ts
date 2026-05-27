/**
 * Test-only RSA keypair + self-signed X.509 generator for the XAdES signer
 * tests (TASKS-0024 §4.1).
 *
 * Returns PEM strings in the same shape that
 * `certificates/parser.ts#parseP12` emits (so the signer receives the
 * same handle shape regardless of whether the cert comes from a .p12 or
 * from this helper). Bytes never touch disk; the buffers are scoped to
 * the test that calls the helper.
 *
 * Why a separate helper instead of reusing `synthetic-cert.ts`?
 *   - `synthetic-cert.ts` wraps the cert into a PKCS#12 archive (needed
 *     for the upload/decrypt path tests). The signer doesn't need a .p12
 *     — it consumes PEMs directly. A direct PEM helper means a signer
 *     test failure is unambiguously a signer bug, not a p12-parse bug.
 *   - We can produce a "wrong key" cert just by calling the helper twice;
 *     each call yields independent RSA material.
 */
import { generateKeyPairSync } from "node:crypto";

import forge from "node-forge";

export interface TestCertOptions {
  readonly subjectCN?: string;
  readonly issuerCN?: string;
  readonly validFrom?: Date;
  readonly validTo?: Date;
  readonly serialHex?: string;
}

export interface TestCertResult {
  readonly certPem: string;
  readonly keyPem: string;
  readonly validFrom: Date;
  readonly validTo: Date;
}

/**
 * Generate a synthetic RSA-2048 keypair + self-signed cert in PEM form.
 *
 * Default validity is "1 year starting now" so the signer's cert-expiry
 * guard never trips unintentionally. Tests that want to exercise the
 * `CERT_EXPIRED` branch pass an explicit `validTo` in the past.
 */
export function makeTestCert(options: TestCertOptions = {}): TestCertResult {
  const now = new Date();
  const validFrom = options.validFrom ?? new Date(now.getTime() - 60_000);
  const validTo = options.validTo ?? new Date(now.getTime() + 365 * 24 * 3_600_000);

  // Generate the RSA keypair via Node's native crypto (fast) and import
  // into forge for self-signing.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(privatePem);
  const forgePublicKey = forge.pki.rsa.setPublicKey(forgeKey.n, forgeKey.e);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = options.serialHex ?? "0123456789abcdef";
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validTo;
  cert.setSubject([{ shortName: "CN", value: options.subjectCN ?? "Test CN" }]);
  cert.setIssuer([{ shortName: "CN", value: options.issuerCN ?? options.subjectCN ?? "Test CN" }]);
  cert.sign(forgeKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(forgeKey),
    validFrom,
    validTo,
  };
}
