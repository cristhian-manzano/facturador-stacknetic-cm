/**
 * `.p12` parser — extracts metadata + PEMs from a PKCS#12 archive using
 * `node-forge`.
 *
 * Source of truth:
 *   - SPEC-0021 §6.2 (interface + algorithm).
 *   - TASKS-0021 §2.1 (error mapping).
 *   - PLAN-0021 §4 Phase 2 (no I/O, no logging — pure extraction).
 *
 * Security policy:
 *   - This module touches private key material; nothing here is logged.
 *     Callers feed the buffer in, get the parsed result back, and the
 *     parsed object's `keyPem` MUST NEVER be persisted. The active-cert
 *     helper keeps it in an in-memory LRU only.
 *   - The fingerprint is the SHA-256 of the DER-encoded X.509 cert,
 *     hex-encoded lowercase. We use the DER (not the PEM) so the value
 *     is stable across whitespace differences.
 */
import { createHash } from "node:crypto";

import forge from "node-forge";

import { BadPassphraseError, ExpiredCertificateError, ParseError } from "./errors.js";

export interface ParsedCertificate {
  readonly subjectCN: string;
  readonly issuerCN: string;
  /** SRI exposes `serialNumber` as a hex string. node-forge returns hex too. */
  readonly serialHex: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  /** SHA-256 hex (lowercase) of the DER-encoded certificate. */
  readonly fingerprintSha256: string;
  /** PEM-encoded X.509 — used by SPEC-0024 (XAdES-BES) downstream. */
  readonly certPem: string;
  /** PEM-encoded RSA private key — keep in-memory only, never persist. */
  readonly keyPem: string;
}

export interface ParseP12Options {
  /**
   * If true, an already-expired certificate is allowed to pass parsing.
   * Default is false. Callers use the flag when re-parsing a previously
   * uploaded cert that has since expired (the expiry cron + the active
   * cert load path enable it so we can still surface the metadata).
   */
  readonly allowExpired?: boolean;
  /**
   * Optional clock override for tests.
   */
  readonly now?: Date;
}

function bufferToForgeBinary(buf: Buffer): string {
  // node-forge expects raw binary in a JS string ("binary encoding").
  return forge.util.binary.raw.encode(new Uint8Array(buf));
}

function extractCommonName(attrs: forge.pki.CertificateField[]): string {
  const cn = attrs.find((attr) => attr.shortName === "CN" || attr.type === "2.5.4.3");
  if (cn === undefined) return "";
  const value = cn.value;
  return typeof value === "string" ? value : "";
}

/**
 * Parse a .p12 archive. Returns metadata + PEMs in one shot.
 *
 * Errors:
 *   - `BadPassphraseError` — wrong passphrase (node-forge surfaces this
 *     via a "PKCS#12 MAC could not be verified" message).
 *   - `ExpiredCertificateError` — validTo < now and `allowExpired !== true`.
 *   - `ParseError` — anything else (truncated, wrong file, no cert bag).
 */
export function parseP12(
  buffer: Buffer,
  passphrase: string,
  options: ParseP12Options = {},
): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(bufferToForgeBinary(buffer));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      message.includes("mac") ||
      message.includes("password") ||
      message.includes("invalid password") ||
      message.includes("authsafe")
    ) {
      throw new BadPassphraseError();
    }
    throw new ParseError(message.length === 0 ? "unknown parse error" : message);
  }

  const certOid = forge.pki.oids.certBag;
  const keyOid = forge.pki.oids.pkcs8ShroudedKeyBag;
  if (certOid === undefined || keyOid === undefined) {
    throw new ParseError("forge oids missing — node-forge version mismatch");
  }
  const certBags = p12.getBags({ bagType: certOid })[certOid];
  const keyBags = p12.getBags({ bagType: keyOid })[keyOid];

  const certBag = certBags?.[0];
  const keyBag = keyBags?.[0];
  if (certBag?.cert === undefined || keyBag?.key === undefined) {
    throw new ParseError("missing certificate or private key bag");
  }
  const cert = certBag.cert;
  const key = keyBag.key as forge.pki.rsa.PrivateKey;

  const subjectCN = extractCommonName(cert.subject.attributes);
  const issuerCN = extractCommonName(cert.issuer.attributes);
  const validFrom = cert.validity.notBefore;
  const validTo = cert.validity.notAfter;

  const now = options.now ?? new Date();
  if (options.allowExpired !== true && validTo.getTime() <= now.getTime()) {
    throw new ExpiredCertificateError();
  }

  // node-forge stores the serial as a hex string. Pad to even length to
  // make the value cleanly displayable.
  // Defensive: node-forge typings claim `serialNumber: string` but in
  // practice some malformed certs surface it as `null`. Belt and braces.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const rawSerial = cert.serialNumber ?? "";
  const serialHex =
    rawSerial.length % 2 === 0 ? rawSerial.toLowerCase() : `0${rawSerial}`.toLowerCase();

  // Fingerprint over the DER-encoded cert.
  const derString = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  // Convert the forge "binary string" to a Buffer for `createHash`.
  const derBytes = Buffer.from(derString, "binary");
  const fingerprintSha256 = createHash("sha256").update(derBytes).digest("hex");

  return {
    subjectCN,
    issuerCN,
    serialHex,
    validFrom,
    validTo,
    fingerprintSha256,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(key),
  };
}
