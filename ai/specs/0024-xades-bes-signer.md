---
id: SPEC-0024
title: XAdES-BES signer
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0020, SPEC-0021, SPEC-0023]
blocks: [SPEC-0026, SPEC-0033]
---

# SPEC-0024 — XAdES-BES signer

## 1. Purpose

Sign the canonical XML produced by [SPEC-0023](./0023-xml-builder-factura.md) using the tenant's active `.p12` per [SPEC-0021](./0021-certificate-management.md). The output must be a valid **enveloped XAdES-BES** signature accepted by the SRI's recepción service.

## 2. Scope

### 2.1 In scope

- Pure function `signFacturaXml({ xml, privateKeyPem, certPem, hash? }): Promise<string>`.
- Local verification function `verifyFacturaSignature(xml: string): Promise<{ ok: boolean; reason?: string }>` for pre-flight checks.
- Canonical algorithm choices (SHA-1 default for max compatibility with legacy SRI-accepted certs; configurable to SHA-256).
- Reference URI `"#comprobante"` to the root.
- Inclusion of certificate DER in `<X509Data><X509Certificate>`.
- `xades:SignedProperties` with `SigningTime`, `SigningCertificate` digest.
- Second `<Reference Type="http://uri.etsi.org/01903#SignedProperties">` over the signed properties.

### 2.2 Out of scope

- XAdES-EPES / XAdES-T / XAdES-LT (long-term archival). SRI requires only BES.
- Time-stamping authorities.
- Counter-signatures.

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §10.
- [`ai/context/sri-domain.md`](../context/sri-domain.md) §Signing.
- XAdES spec: ETSI TS 101 903 v1.4.2.

## 4. Functional requirements

- **FR-1.** Signing produces a single `<ds:Signature>` element appended as the **last child** of `<factura>`.
- **FR-2.** Signature algorithm:
  - `SignatureMethod`: `http://www.w3.org/2000/09/xmldsig#rsa-sha1` (default) or `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` (opt-in via param).
  - `DigestMethod`: `http://www.w3.org/2000/09/xmldsig#sha1` or `sha256` (match `hash` param).
  - `CanonicalizationMethod`: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` (inclusive C14N).
- **FR-3.** References:
  - **R1** — URI `"#comprobante"`, transforms `enveloped-signature` then `c14n`.
  - **R2** — over `<xades:SignedProperties>`, Type `http://uri.etsi.org/01903#SignedProperties`.
- **FR-4.** `KeyInfo` contains `<X509Data><X509Certificate>` with the DER-encoded cert in Base64 (no PEM headers).
- **FR-5.** `xades:SignedProperties` contains:
  - `xades:SigningTime` (ISO 8601 with timezone).
  - `xades:SigningCertificate/CertDigest` (digest of the cert using the same `hash`).
  - `xades:IssuerSerial` with `X509IssuerName` and `X509SerialNumber`.
- **FR-6.** No BOM in output; output is well-formed XML with the original declaration preserved.
- **FR-7.** Local verification recomputes both references and the signature; reports specific failure reasons (digest mismatch, signature invalid, certificate untrusted at the basic level — chain validation is out of scope for v1).

## 5. Non-functional requirements

- **NFR-1.** Signing ≤ 200 ms for a 50 KB XML on dev hardware.
- **NFR-2.** Pure (no I/O) — caller provides PEMs.
- **NFR-3.** Output is deterministic except for `xades:SigningTime`; tests inject a fixed clock.

## 6. Technical design

### 6.1 Library choice

Use [`xadesjs`](https://github.com/PeculiarVentures/xadesjs) backed by Node `crypto.webcrypto` and `@xmldom/xmldom`. It is the most-aligned-with-SRI JS implementation in the wild.

If `xadesjs` proves brittle (it sometimes is for SRI specifics), fall back to a hand-rolled implementation using `xml-crypto` + `xmldsig` + custom XAdES properties construction. The interface in this spec stays stable either way.

### 6.2 Layout

```
apps/sri-core/src/documents/sign/
├── sign-factura.ts       # signFacturaXml
├── verify-factura.ts     # verifyFacturaSignature
└── webcrypto-setup.ts    # one-time engine init
```

### 6.3 One-time engine init

```ts
// apps/sri-core/src/documents/sign/webcrypto-setup.ts
import { webcrypto } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xmlCore from "xml-core";
import { Application } from "xadesjs";

let initialized = false;
export const ensureXadesJsEngine = (): void => {
  if (initialized) return;
  xmlCore.setNodeDependencies({
    DOMParser,
    XMLSerializer,
    DOMImplementation: new DOMParser().implementation as any,
    xpath: require("xpath"),
  });
  Application.setEngine("NodeJS", webcrypto as any);
  initialized = true;
};
```

### 6.4 Sign function

```ts
// apps/sri-core/src/documents/sign/sign-factura.ts
import { ensureXadesJsEngine } from "./webcrypto-setup.js";
import { SignedXml, type OptionsXmlSign, Application } from "xadesjs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { webcrypto } from "node:crypto";

export interface SignOptions {
  xml: string;
  privateKeyPem: string;
  certPem: string;
  hash?: "SHA-1" | "SHA-256";
  now?: () => Date;
}

const pemToBase64 = (pem: string): string =>
  pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

const importPrivateKey = async (pem: string, hash: "SHA-1" | "SHA-256"): Promise<CryptoKey> => {
  const base64 = pemToBase64(pem);
  const der = Buffer.from(base64, "base64");
  return webcrypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: { name: hash } },
    false,
    ["sign"],
  );
};

export const signFacturaXml = async ({
  xml,
  privateKeyPem,
  certPem,
  hash = "SHA-1",
  now,
}: SignOptions): Promise<string> => {
  ensureXadesJsEngine();

  const certB64 = pemToBase64(certPem);
  const privateKey = await importPrivateKey(privateKeyPem, hash);

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const signed = new SignedXml(doc);

  const options: OptionsXmlSign = {
    algorithm: { name: "RSASSA-PKCS1-v1_5", hash: { name: hash } } as any,
    keyValue: privateKey as any,
    x509: [certB64],
    signingCertificate: certB64,
    references: [
      {
        uri: "#comprobante",
        hash,
        transforms: ["enveloped", "c14n"],
      },
    ],
    signingTime: { value: now ? now() : new Date() },
  };

  await signed.Sign(options.algorithm, privateKey as any, doc, options);
  return new XMLSerializer().serializeToString(doc);
};
```

### 6.5 Verify function

```ts
// apps/sri-core/src/documents/sign/verify-factura.ts
import { ensureXadesJsEngine } from "./webcrypto-setup.js";
import { SignedXml } from "xadesjs";
import { DOMParser } from "@xmldom/xmldom";

export const verifyFacturaSignature = async (
  xml: string,
): Promise<{ ok: boolean; reason?: string }> => {
  ensureXadesJsEngine();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const signatures = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (signatures.length !== 1) return { ok: false, reason: "expected exactly one Signature" };
  const signed = new SignedXml(doc);
  signed.LoadXml(signatures[0] as unknown as Element);
  try {
    const ok = await signed.Verify();
    return ok ? { ok: true } : { ok: false, reason: "signature verification returned false" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
};
```

### 6.6 Whitespace and serialization concerns

- The XML is **already** single-line out of the builder ([SPEC-0023](./0023-xml-builder-factura.md) §7.3). Do not re-pretty-print before signing.
- `@xmldom/xmldom` `XMLSerializer` may emit slightly different attribute ordering than the input — that's OK as long as canonicalization for the digest is deterministic. The signer uses inclusive C14N, which canonicalizes attribute order.
- If the document came in with a UTF-8 BOM (shouldn't, but be defensive), strip it before parsing.

## 7. Implementation guide

### 7.1 Steps

1. Add the deps from §7.2 to `apps/sri-core`.
2. Implement files in §6.2.
3. Generate a synthetic self-signed test cert (`tools/generate-test-cert.ts` — RSA-2048, 1-year validity). **Do not commit a real `.p12`.**
4. Unit tests:
   - Sign a fixture XML → `verifyFacturaSignature` returns `{ ok: true }`.
   - Tamper a digit of the signed XML body → verify returns `{ ok: false }`.
   - Sign with SHA-256 → verify returns `{ ok: true }`.
   - Snapshot a sign with a fixed `now` and same cert → byte-identical output (used as canary for library upgrades).

### 7.2 Dependencies (apps/sri-core)

| Package          | Version   | Purpose               |
| ---------------- | --------- | --------------------- |
| `xadesjs`        | `^2.4.4`  | XAdES sign/verify.    |
| `@xmldom/xmldom` | `^0.8.10` | DOM.                  |
| `xpath`          | `^0.0.34` | Needed by `xml-core`. |
| `xml-core`       | `^1.2.0`  | xadesjs engine glue.  |

### 7.3 Conventions

- Signer never reads PEMs from disk — always argument-injected.
- No global state beyond `webcrypto-setup` (idempotent).
- A unit test asserts that signing twice with the same `now` and inputs yields identical output (after dropping the `SignatureValue` which depends on RSA padding — actually RSA-PKCS#1 v1.5 is deterministic, so byte-identical is achievable).

## 8. Acceptance criteria

- **AC-1.** Signed output contains a `<ds:Signature>` element with one `<ds:SignedInfo>` containing two `<ds:Reference>` (one to `#comprobante`, one to SignedProperties).
- **AC-2.** Signed output contains `<xades:SigningTime>`, `<xades:SigningCertificate>/<xades:CertDigest>`, `<xades:IssuerSerial>`.
- **AC-3.** `verifyFacturaSignature` returns `{ ok: true }` for a freshly signed XML.
- **AC-4.** Flipping one byte in `<infoFactura>` after signing makes verify return `{ ok: false }`.
- **AC-5.** Signing with SHA-256 produces `SignatureMethod = rsa-sha256`.
- **AC-6.** Signing a 50 KB XML completes in ≤ 200 ms on dev hardware.
- **AC-7.** A snapshot test of a signed XML with a fixed cert, fixed input, and fixed `now` is byte-stable across multiple runs.
- **AC-8.** No file system access during signing (verifiable by intercepting `fs` calls in tests).

## 9. Test plan

- Unit: sign/verify happy path with each hash.
- Unit: tamper-detection.
- Integration with [SPEC-0023](./0023-xml-builder-factura.md): build a factura → sign → verify → XSD validate (signed XML must still validate against the factura XSD with the optional `ds:Signature` slot populated).

## 10. Security considerations

- Private key material is in memory only for the duration of `signFacturaXml`. Callers must not retain `privateKeyPem` strings beyond what's needed.
- `xadesjs` is C14N-correct in our usage but historically tricky with `xmldom` whitespace. The snapshot test guards against silent regressions on library upgrade.
- Refuse to sign if the input XML does not start with `<?xml`, contains a BOM, or has more than one root.

## 11. Observability

- Log `factura.sign.success` with `claveAcceso`, `bytesIn`, `bytesOut`, `hash`, `signingTime`. Never log the cert, key, or XML.
- Log `factura.sign.failure` with `reason` (mapped from `verify-factura` if local pre-flight catches an issue).

## 12. Risks and mitigations

| Risk                                                         | Mitigation                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `xadesjs` upgrade breaks compatibility with SRI              | Snapshot byte-stability test + fixture round-trip against SRI test environment (manual or integration). |
| Whitespace introduced by serialization invalidates signature | Single-line input contract + integration test that re-parses and re-verifies.                           |
| Cert too old (SHA-1 only)                                    | Default hash is SHA-1; allow opt-in SHA-256.                                                            |

## 13. Open questions

- Move to a WASM-based signer (`node-signpdf`-style approach for XML)? Not now; `xadesjs` is the pragmatic choice. Revisit if it becomes unmaintained.
- Support multiple signers (counter-signature) for a workflow where the accountant signs after the operator? Out of scope; SRI doesn't require it.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
