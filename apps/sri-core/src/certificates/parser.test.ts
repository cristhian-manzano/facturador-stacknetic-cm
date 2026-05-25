/**
 * Unit tests for `parseP12`.
 *
 * Strategy: generate a self-signed PKCS#12 in `beforeAll` using
 * `generateSyntheticP12`. The bytes never touch disk; no real certificate
 * material is ever committed (ai/context/security.md).
 *
 * Cases:
 *   - happy path → returns expected metadata + PEMs.
 *   - wrong passphrase → BadPassphraseError.
 *   - already-expired cert → ExpiredCertificateError (and `allowExpired`
 *     reopens it).
 *   - corrupt buffer → ParseError.
 *   - re-encoded fingerprint stable across calls.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { generateSyntheticP12 } from "../../test/fixtures/synthetic-cert.js";
import { BadPassphraseError, ExpiredCertificateError, ParseError } from "./errors.js";
import { parseP12 } from "./parser.js";

const PASSPHRASE = "p4ssw0rd-test";

const day = 86_400_000;

describe("parseP12 — happy path", () => {
  let p12: Buffer;
  const subject = "STACKNETIC TEST CERT";
  const validFrom = new Date(Date.now() - day);
  const validTo = new Date(Date.now() + 30 * day);

  beforeAll(() => {
    const result = generateSyntheticP12({
      subjectCN: subject,
      validFrom,
      validTo,
      passphrase: PASSPHRASE,
    });
    p12 = result.p12;
  });

  it("returns the expected metadata", () => {
    const parsed = parseP12(p12, PASSPHRASE);
    expect(parsed.subjectCN).toBe(subject);
    expect(parsed.issuerCN).toBe(subject); // self-signed
    expect(parsed.serialHex.length).toBeGreaterThan(0);
    // X.509 timestamps are seconds-precision, so we compare within ±1 s.
    expect(Math.abs(parsed.validFrom.getTime() - validFrom.getTime())).toBeLessThanOrEqual(1000);
    expect(Math.abs(parsed.validTo.getTime() - validTo.getTime())).toBeLessThanOrEqual(1000);
    expect(parsed.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.certPem.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(parsed.keyPem.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  it("computes the fingerprint deterministically across calls", () => {
    const a = parseP12(p12, PASSPHRASE);
    const b = parseP12(p12, PASSPHRASE);
    expect(a.fingerprintSha256).toBe(b.fingerprintSha256);
  });
});

describe("parseP12 — failure paths", () => {
  it("throws BadPassphraseError on wrong passphrase", () => {
    const { p12 } = generateSyntheticP12({
      subjectCN: "WP CERT",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 30 * day),
      passphrase: "correct",
    });
    expect(() => parseP12(p12, "wrong")).toThrow(BadPassphraseError);
  });

  it("throws ExpiredCertificateError when validTo is in the past", () => {
    const { p12 } = generateSyntheticP12({
      subjectCN: "EXPIRED CERT",
      validFrom: new Date(Date.now() - 10 * day),
      validTo: new Date(Date.now() - day),
      passphrase: PASSPHRASE,
    });
    expect(() => parseP12(p12, PASSPHRASE)).toThrow(ExpiredCertificateError);
  });

  it("returns the parsed cert when allowExpired=true (so re-parsing works)", () => {
    const { p12 } = generateSyntheticP12({
      subjectCN: "EXPIRED CERT",
      validFrom: new Date(Date.now() - 10 * day),
      validTo: new Date(Date.now() - day),
      passphrase: PASSPHRASE,
    });
    const parsed = parseP12(p12, PASSPHRASE, { allowExpired: true });
    expect(parsed.subjectCN).toBe("EXPIRED CERT");
  });

  it("throws ParseError on a corrupt buffer", () => {
    expect(() => parseP12(Buffer.from("not a p12"), "any")).toThrow(ParseError);
  });

  it("throws ParseError when passing an empty buffer", () => {
    expect(() => parseP12(Buffer.alloc(0), "any")).toThrow(ParseError);
  });
});
