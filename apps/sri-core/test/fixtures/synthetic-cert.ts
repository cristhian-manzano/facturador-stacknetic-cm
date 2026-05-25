/**
 * Synthetic .p12 fixture generator.
 *
 * Test-only. No real certificates are ever committed to the repository
 * (see ai/context/security.md). This module produces an entirely random
 * self-signed RSA cert + PKCS#12 archive in memory, with caller-controlled
 * validity dates, subject CN, and passphrase. The bytes never touch disk.
 *
 * Strategy:
 *   - Generate an RSA-2048 keypair via `node:crypto.generateKeyPair`.
 *   - Build a forge X.509 cert with that key, set notBefore / notAfter,
 *     self-sign with SHA-256.
 *   - Wrap into a forge PKCS#12 archive under the supplied passphrase,
 *     return the DER-encoded bytes.
 *
 * Why a small RSA size: tests should be fast. 2048 is the SRI minimum
 * (BCE issues 2048-bit RSA certs) so we mirror real-world parsing.
 */
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

export interface SyntheticCertOptions {
  readonly subjectCN: string;
  readonly issuerCN?: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly passphrase: string;
  /** Override serial number (hex). Defaults to a random 8-byte hex string. */
  readonly serialHex?: string;
}

export interface SyntheticCertResult {
  /** DER-encoded PKCS#12 bytes ready to upload. */
  readonly p12: Buffer;
}

function randomSerialHex(): string {
  // forge cert.serialNumber must be a positive integer; we use 16 hex
  // chars (= 8 bytes). The high bit is cleared by prepending '0' so it
  // round-trips as a positive INTEGER.
  const bytes = Buffer.from(Array.from({ length: 8 }, () => Math.floor(Math.random() * 256)));
  const hex = bytes.toString("hex");
  return hex.startsWith("0") ? hex : `0${hex.slice(1)}`;
}

export function generateSyntheticP12(options: SyntheticCertOptions): SyntheticCertResult {
  // Generate an RSA keypair via Node's native crypto, then re-import into
  // forge through PEM. node-forge ships a JS RSA generator but it's slow;
  // Node's is materially faster.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(privatePem) as forge.pki.rsa.PrivateKey;
  // Public key derived from the private key — forge exposes a helper.
  const forgePublicKey = forge.pki.rsa.setPublicKey(forgeKey.n, forgeKey.e);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = options.serialHex ?? randomSerialHex();
  cert.validity.notBefore = options.validFrom;
  cert.validity.notAfter = options.validTo;
  const subject = [{ shortName: "CN", value: options.subjectCN }];
  const issuer = [{ shortName: "CN", value: options.issuerCN ?? options.subjectCN }];
  cert.setSubject(subject);
  cert.setIssuer(issuer);
  cert.sign(forgeKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], options.passphrase, {
    friendlyName: options.subjectCN,
    algorithm: "3des",
  });
  const derBuf = forge.asn1.toDer(p12Asn1).getBytes();
  return { p12: Buffer.from(derBuf, "binary") };
}
