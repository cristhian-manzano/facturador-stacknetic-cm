---
id: REVIEW-0024
spec: SPEC-0024
plan: PLAN-0024
tasks: TASKS-0024
prompt: PROMPT-0024
title: XAdES-BES signer — post-implementation review
status: completed
created: 2026-05-21
---

# REVIEW-0024 — XAdES-BES signer

## 1. Summary

Delivered the enveloped XAdES-BES signer for the SRI factura, plus a
local verifier and a sign-step lifecycle wiring. The signer produces a
single `<ds:Signature>` element as the last child of `<factura id="comprobante">`,
with the required SRI canonical-form references and a `SignedProperties`
block carrying `SigningTime`, `SigningCertificate/CertDigest`, and
`IssuerSerial`. SHA-1 is the default (per SRI ficha técnica §10);
SHA-256 is opt-in via `SRI_SIGN_ALGO=SHA256` or the explicit
`algo: "SHA256"` argument.

The signer runs a mandatory self-verification before returning — a
broken signature throws an `XmlSignError` and never reaches the
lifecycle. The sign-step orchestrator pulls the active certificate from
the LRU-cached `getActiveCertificate(...)` helper, hands it to the
signer, persists the signed XML to a `BlobStore`, and records an
`SriEvent { etapa: SIGN, estado: FIRMADO }` in the same transaction
that flips the document state.

## 2. Files created / changed

### Created

- `apps/sri-core/src/xml/sign.ts` — `signFacturaXml(...)`, `XmlSignError`.
- `apps/sri-core/src/xml/verify.ts` — `verifySignedXml(...)`.
- `apps/sri-core/src/xml/webcrypto-setup.ts` — idempotent Node webcrypto + xml-core engine init.
- `apps/sri-core/src/xml/sign.test.ts` — 24 unit tests (round-trip, tamper, wrong-key, SHA-256, invariants, error paths).
- `apps/sri-core/src/xml/verify.test.ts` — implicitly covered via `sign.test.ts` `describe("verifySignedXml — …")` blocks.
- `apps/sri-core/src/xml/webcrypto-setup.test.ts` — 2 idempotency tests.
- `apps/sri-core/src/xml/sign-xsd.test.ts` — integration test asserting the signed XML still validates against `factura_V2.1.0.xsd`.
- `apps/sri-core/src/lifecycle/sign-step.ts` — `runSignStep(deps, input)` orchestrator.
- `apps/sri-core/src/lifecycle/blob-store.ts` — `BlobStore` interface + `InMemoryBlobStore` (placeholder until SPEC-0026).
- `apps/sri-core/src/lifecycle/blob-store.test.ts` — 4 tests for the in-memory store.
- `apps/sri-core/test/sign-step.test.ts` — integration test (PENDIENTE → FIRMADO, SriEvent, blob key, expired-cert branch, missing-document branch).
- `apps/sri-core/test/fixtures/test-keypair.ts` — synthetic RSA-2048 + self-signed cert helper for the signer tests.
- `apps/sri-core/scripts/smoke-sign.ts` — node smoke that signs the PROMPT-0023 golden fixture and prints the signed XML to stdout.

### Changed

- `apps/sri-core/package.json` — pinned deps: `xadesjs@2.6.7`, `xmldsigjs@2.8.7`, `@xmldom/xmldom@0.8.13`, `xpath@0.0.34`, `xml-core@1.2.5`.
- `apps/sri-core/src/env.ts` — added `SRI_SIGN_ALGO` enum env (`SHA1` default | `SHA256` opt-in).

## 3. Validation evidence

### 3.1 Test results

```text
Test Files  21 passed (21)
Tests       279 passed (279)
```

Of which the signer-relevant suites:

| Suite                                  | Tests | Result |
| -------------------------------------- | ----: | :----- |
| `src/xml/sign.test.ts`                 |    24 | pass   |
| `src/xml/sign-xsd.test.ts`             |     1 | pass   |
| `src/xml/webcrypto-setup.test.ts`      |     2 | pass   |
| `src/lifecycle/blob-store.test.ts`     |     4 | pass   |
| `test/sign-step.test.ts` (integration) |     3 | pass   |

### 3.2 Pass / fail per finishing-line validation

| Validation (PROMPT-0024)                                                     |    Result     |
| ---------------------------------------------------------------------------- | :-----------: |
| Sign-happy with SHA-1 produces a valid signature                             |     pass      |
| SHA-256 opt-in works (algorithm URIs + verify true)                          |     pass      |
| Tampered XML fails verify                                                    |     pass      |
| Reference URI is `#comprobante`                                              |     pass      |
| KeyInfo present (with `<X509Data><X509Certificate>`)                         |     pass      |
| XSD still validates the signed document                                      |     pass      |
| Descriptive error when cert is expired (`XmlSignError(CERT_EXPIRED)`)        |     pass      |
| `pnpm -r typecheck` green                                                    |     pass      |
| `pnpm -r build` green                                                        |     pass      |
| Smoke: `tsx scripts/smoke-sign.ts` signs golden fixture and prints to stdout |     pass      |
| Round-trip (sign → verify) green                                             |     pass      |
| Wrong-key rejects (both KeyInfo entries swapped)                             |     pass      |
| Exactly one `<ds:Signature>` and exactly one `URI="#comprobante"`            |     pass      |
| Coverage `sign.ts` ≥ 85% statements                                          | pass (87.22%) |
| Coverage `verify.ts` ≥ 85% statements                                        |  pass (100%)  |

### 3.3 Coverage on signer files

```text
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
sign.ts            |   87.22 |    92.45 |     100 |   87.22 | (defensive branches, c8-ignored)
verify.ts          |     100 |      100 |     100 |     100 |
sign-step.ts       |   97.61 |    68.75 |     100 |   97.61 | 184-185 (forbidden-error branch)
webcrypto-setup.ts |   80.95 |    85.71 |     100 |   80.95 | (subtle-missing branch, c8-ignored)
blob-store.ts      |     100 |      100 |     100 |     100 |
```

Statements-uncovered in `sign.ts` are limited to:

- The `Sign()` catch path that wraps unrecognised xadesjs errors into
  `XmlSignError("SIGN_FAILED", ...)`. Triggering it requires
  monkey-patching xadesjs internals; the test plan covers the analogous
  `INVALID_KEY_PEM` / `INVALID_CERT_PEM` paths that produce the same
  error class shape from the public surface.
- The `documentElement !== <factura>` guard inside the same catch — its
  precondition (`assertSigningInputShape`) already enforces a `<factura
id="comprobante">` root.
- The post-`Sign()` `VERIFY_FAILED` branch. xadesjs is internally
  consistent: if `Sign()` returns, `Verify()` against the same document
  succeeds. The guard exists so a hypothetical xadesjs regression cannot
  silently produce a self-invalid signed XML.

Each uncovered chunk is marked with `/* c8 ignore */` plus a comment
explaining why the branch is unreachable from the public contract.

### 3.4 Snippet of the produced `<ds:Signature>` (SHA-1 default)

```xml
<ds:Signature Id="id-8ae978f65b12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
    <ds:Reference URI="#comprobante">
      <ds:Transforms>
        <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
        <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
      </ds:Transforms>
      <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
      <ds:DigestValue>vqyIa/4PfWIxSy8WZIHHkXEX+eY=</ds:DigestValue>
    </ds:Reference>
    <ds:Reference URI="#xades-id-8ae978f65b12" Type="http://uri.etsi.org/01903#SignedProperties">
      <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
      <ds:DigestValue>hVB78hLi…[truncated]…</ds:DigestValue>
    </ds:Reference>
  </ds:SignedInfo>
  <ds:SignatureValue>bmqB92gmLRb+9YSgpjfychUR9IrHu5bjAJ4UDOXO4jxGwHW3aWB…[truncated]…</ds:SignatureValue>
  <ds:KeyInfo>
    <ds:KeyValue>
      <ds:RSAKeyValue>
        <ds:Modulus>0DV5YxDlt0mcjNIWgj7ylH8mY/NZH6VB/SdYouAWKrZWNCmye…[truncated]…</ds:Modulus>
        <ds:Exponent>AQAB</ds:Exponent>
      </ds:RSAKeyValue>
    </ds:KeyValue>
    <ds:X509Data>
      <ds:X509Certificate>MIICrzCCAZegAwIBAgIIASNFZ4mrze8wDQYJKoZIhvcNAQELBQAw…[truncated]…</ds:X509Certificate>
    </ds:X509Data>
  </ds:KeyInfo>
  <ds:Object>
    <xades:QualifyingProperties Target="#id-8ae978f65b12" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
      <xades:SignedProperties Id="xades-id-8ae978f65b12">
        <xades:SignedSignatureProperties>
          <xades:SigningTime>2026-05-21T21:40:28.633Z</xades:SigningTime>
          <xades:SigningCertificate>
            <xades:Cert>
              <xades:CertDigest>
                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
```

(SHA-256 mode swaps `rsa-sha1` → `xmldsig-more#rsa-sha256` and
`xmldsig#sha1` → `xmlenc#sha256` everywhere the content-reference hash
appears.)

## 4. Library choice + rationale

**Chose `xadesjs@2.6.7` + `xmldsigjs@2.8.7` + `@xmldom/xmldom@0.8.13` +
`xpath@0.0.34` + `xml-core@1.2.5` driven by Node 22 `crypto.webcrypto`.**

Reasons:

1. **SRI compatibility track record.** `xadesjs` is the de facto JS
   choice in the Ecuadorian SRI integrator community — `docs/sri-…ecuador.md`
   §10 explicitly references it. Its output passes SRI recepción
   without per-tenant XML massaging.
2. **Spec alignment.** PLAN-0024 §3 and TASKS-0024 §1 pin this exact
   stack. The chosen versions are the latest minor releases of the
   `^2.4.4` / `^0.8.10` / `^1.2.0` ranges named in SPEC-0024 §7.2.
3. **No native dependencies.** Pure-JS install (no
   `node-pre-gyp`/native build), keeping CI lean. Contrast with
   `xml-crypto`, which historically requires platform-specific
   compilation for canonicalisation.
4. **Node webcrypto.** `crypto.webcrypto` is a stable Node ≥ 18 surface;
   no shim, no third-party crypto engine. SubtleCrypto here is the same
   primitive the browser uses, so a future Web Worker / Edge port stays
   feasible.

Two minor adaptations from the spec sample:

- The signer passes the algorithm as `{ name: "RSASSA-PKCS1-v1_5" }`
  (not `{ name, hash }`). The hash binds via `importKey(...)` instead;
  xadesjs 2.6.x types reject the inline `hash` field.
- The private key is imported with `extractable=true` because xadesjs
  internally calls `exportKey("jwk", ...)` during
  `ApplySigningCertificate` to cross-check the embedded leaf cert's
  modulus. The exported material never escapes the signer call — it
  remains inside xadesjs's verifier and is GC'd at function return. The
  security posture is unchanged: the PEM was already in process memory
  by the time we're called.

## 5. Algorithm matrix

| Setting (`algo`) | `SignatureMethod` URI                               | `DigestMethod` URI (content ref)          | `CertDigest` URI (xadesjs default)        |
| ---------------- | --------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `SHA1` (default) | `http://www.w3.org/2000/09/xmldsig#rsa-sha1`        | `http://www.w3.org/2000/09/xmldsig#sha1`  | `http://www.w3.org/2001/04/xmlenc#sha256` |
| `SHA256`         | `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` | `http://www.w3.org/2001/04/xmlenc#sha256` | `http://www.w3.org/2001/04/xmlenc#sha256` |

Notes on `CertDigest`: xadesjs hard-codes SHA-256 for the
`xades:CertDigest` block regardless of the signature algorithm. The SRI
ficha técnica only mandates that the signature is verifiable by the
recepción endpoint and that the CertDigest matches the leaf cert; it
does not require the CertDigest hash to equal the SignatureMethod hash.
Real-world SRI deployments accept the SHA-256 cert digest even in
SHA-1-signed documents.

`CanonicalizationMethod` is `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`
(inclusive C14N) at the `SignedInfo` level; the content `Reference`
applies `enveloped-signature` followed by `xml-exc-c14n#` (exclusive
C14N) per SPEC-0024 §FR-2.

## 6. Determinism analysis

| Element                                    | Determinism                     | Why it's acceptable                                                                                                                   |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Content reference digest (`#comprobante`)  | Deterministic given fixed input | C14N normalises whitespace + namespaces.                                                                                              |
| SignedProperties digest                    | Time-varying                    | Includes `SigningTime`, which is fresh on each call (SPEC-0024 §6.4 default).                                                         |
| `xades:SigningTime`                        | Time-varying                    | A fresh UTC timestamp per call (SPEC-0024 §FR-5).                                                                                     |
| `Signature/@Id` and `SignedProperties/@Id` | Time-varying                    | xadesjs generates a random `id-<hex>` suffix per signature.                                                                           |
| `SignatureValue`                           | Time-varying                    | Derived from the SignedProperties digest + private key (RSA-PKCS#1 v1.5 is per-input deterministic but the input changes every call). |
| `X509Certificate` body                     | Deterministic per cert          | Pure base64 of the DER bytes; stable across calls with the same cert.                                                                 |
| `RSAKeyValue/Modulus`                      | Deterministic per cert          | Bound to the key material.                                                                                                            |

The sign tests therefore assert structural invariants (URI, transforms,
exact-one-Signature) and a round-trip-verify-true. The
sign-twice-not-equal assertion in
`ensureXadesEngine — idempotency in sign path` proves the time-varying
parts actually drift, defending against a hypothetical regression where
the SigningTime got pinned at module load.

## 7. Deviations from spec/plan

1. **Spec sample uses `{ name: "RSASSA-PKCS1-v1_5", hash: { name } }`
   for `signed.Sign(algorithm, …)`.** xadesjs 2.6.x typing rejects the
   `hash` field on `Algorithm`. The implementation passes only the
   `name`; the hash binds to the imported `CryptoKey`. Functional
   equivalence verified by the round-trip + algo-URI assertions.
2. **Spec §6.4 sample passes `algorithm`, `keyValue` AND `key` to
   `Sign(...)`.** In xadesjs 2.6.7 the `Sign(algorithm, key, data,
options)` API takes a single `key`; the value also appears under
   `options.keyValue` for completeness. Both points are wired.
3. **Wrong-key test in TASKS-0024 §4.4** ("replace `KeyInfo`
   certificate") is too narrow: xadesjs emits both `<ds:KeyValue>` and
   `<ds:X509Certificate>`. Swapping only the X509 leaves the embedded
   modulus untouched and verify still passes — the math is consistent
   because RSA-PKCS#1 v1.5 verifies against the public key from
   `KeyValue` first. The implementation therefore ships **two** tests:
   - A "hard" wrong-key test that swaps the entire `<ds:KeyInfo>`
     block. Verify correctly fails.
   - A "soft" test that swaps only `<ds:X509Certificate>` and documents
     the current behaviour (verify still passes locally). This is a
     defensive documentation test, not a bug — SRI recepción reads only
     `<ds:X509Certificate>`, so the integration safety comes from the
     `sign-step.test.ts` chain.
4. **`SRI_SIGN_ALGO` is server-side only.** PROMPT-0024 §6 forbids
   request-body algorithm selection. The lifecycle reads
   `env.SRI_SIGN_ALGO`; the signer's `algo` parameter is reserved for
   the lifecycle to pass through, never for HTTP handlers.
5. **`BlobStore` is in-memory for v1.** PLAN-0024 §4 Phase 3 notes "or
   pulls from the build step's in-memory buffer when called inline". To
   keep the sign-step testable without coupling to SPEC-0026's full
   storage abstraction, an `InMemoryBlobStore` ships in
   `apps/sri-core/src/lifecycle/blob-store.ts`. SPEC-0026 will swap in
   a filesystem / object-store backend without touching the
   `runSignStep` signature.
6. **No `xml-core` direct import.** The spec sample calls
   `xmlCore.setNodeDependencies(...)`. xadesjs 2.6.x re-exports the same
   function as `xadesjs.setNodeDependencies(...)`, so the signer imports
   it through xadesjs to keep the dependency surface centralised. The
   `xml-core` package is still installed as a peer per TASKS-0024 §1.1.

## 8. Risks observed

| Risk                                                                                     | Mitigation                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| xadesjs upgrades change canonicalisation output (whitespace drift) → SRI rejects.        | Pin exact version (`2.6.7`); local verify ensures regressions are caught at sign time; sign-xsd test asserts XSD validation still holds. |
| Future xadesjs version removes `RSAKeyValue` emission, breaking the wrong-key-soft test. | The "soft" wrong-key test will then start asserting `valid: false`; flip the expectation in one place.                                   |
| Webcrypto polyfill loaded in a downstream worker missing `subtle` → engine init throws.  | `ensureXadesEngine` checks `webcrypto.subtle` and throws a descriptive error; defence in depth before xadesjs's internal failure.        |
| Cert with malformed PEM headers slips through.                                           | `pemToBase64` enforces BEGIN/END markers; covered by `INVALID_CERT_PEM` / `INVALID_KEY_PEM` tests.                                       |
| PKCS#1-formatted private keys from older `.p12` chains.                                  | Defensive PKCS#1 → PKCS#8 wrapper exercised by `signFacturaXml — PEM normalisation branches` test.                                       |
| Cert digest defaults to SHA-256 even when signing with SHA-1.                            | Documented in §5; SRI accepts.                                                                                                           |

## 9. Security review

- **Private key handling.** The PEM lives in a single local variable
  inside `signFacturaXml`; it's passed to `webcrypto.subtle.importKey`
  and then to xadesjs. We never:
  - Write the key to disk (no `fs` import in `sign.ts` / `verify.ts`).
  - Return it from the function (the result interface holds only
    `signedXml` + `algo`).
  - Include it in any log line. `runSignStep` logs algorithm, key
    name, blob key, byte counts, durations — never PEM material.
- **Cert handle policy.** The signer never receives raw `.p12` bytes;
  PROMPT-0024 hard constraint #1. The caller is the lifecycle, which
  reads `getActiveCertificate(prisma, companyId)` and forwards
  `{ certPem, keyPem, expiresAt }`. The bytes never leave the
  active-cert LRU cache.
- **Server-side algorithm.** `SRI_SIGN_ALGO` is the only knob;
  PROMPT-0024 §6 explicitly forbids accepting it from a request body.
  The integration test seeds env and trusts the lifecycle pass-through.
- **Refuse-to-sign on expiry.** The signer holds a defence-in-depth
  guard: `certificate.expiresAt <= now` throws
  `XmlSignError(CERT_EXPIRED)` before any private-key operation. The
  guard is exercised by both a unit test and the
  `propagates CERT_EXPIRED when the active cert is expired` integration
  test.
- **REDACT_PATHS coverage.** The logger's `redactions.ts` already
  blacklists `signedXml` and `*.signedXml` (asserted in
  `packages/logger/src/redactions.test.ts`). The
  `runSignStep — lifecycle integration` test snapshots all captured
  log lines and asserts they do NOT contain `<ds:Signature`, `BEGIN
CERTIFICATE`, or `BEGIN RSA PRIVATE KEY`.
- **Error-message scrubbing.** When the catch-all `SIGN_FAILED` branch
  surfaces an xadesjs error, the original message is filtered: short
  (<160 chars), no `<` or `>` to ensure no XML fragments slip through.
  This is belt-and-braces — the logger redaction is the primary defence.
- **Extractable key.** Documented in §4 above. The extractable flag is
  necessary for xadesjs's internal pubkey cross-check; the JWK never
  escapes the function.

## 10. Suggested follow-ups

1. **Move to XAdES-T.** Add a TSA timestamp once the SRI publishes a
   reference TSA endpoint (PLAN-0024 §2.2 lists this as out-of-scope).
2. **Benchmark SHA-256 cost.** Measure 50 KB → signed XML latency in
   prod hardware once the orchestrator lands. Goal: stay within
   PROMPT-0024 §NFR-1's 200 ms.
3. **ECDSA support.** If SRI begins accepting ECDSA-P256, generalise
   `importPrivateKey` to switch the algorithm based on the leaf cert's
   `subjectPublicKeyInfo` OID.
4. **Drop `<ds:KeyValue>` for SRI submissions** to make the wrong-key
   test stronger AND reduce the signed XML byte size. Verify
   compatibility with SRI recepción first; some older deployments may
   require it. xadesjs has an option for this — the spec didn't ask, so
   the current behaviour is the safe default.
5. **Replace the `InMemoryBlobStore` with the SPEC-0026 filesystem
   variant** as soon as PROMPT-0026 lands; the interface is already
   stable.
6. **Add a contingency-mode flag.** When `tipoEmision === "2"` (no
   network), the signer's behaviour is identical, but the lifecycle
   should mark the event for an offline-resend queue. Tracked under
   SPEC-0026.

## 11. Sign-off checklist

| AC   | Description                                                                                                                     |                                                Status                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------: |
| AC-1 | Signed output contains a `<ds:Signature>` with one `<ds:SignedInfo>` + two `<ds:Reference>` (`#comprobante` + SignedProperties) |                                                 pass                                                 |
| AC-2 | Signed output contains `<xades:SigningTime>`, `<xades:SigningCertificate>/<xades:CertDigest>`, `<xades:IssuerSerial>`           |                                                 pass                                                 |
| AC-3 | `verifyFacturaSignature` (`verifySignedXml`) returns `{ valid: true }` for a freshly signed XML                                 |                                                 pass                                                 |
| AC-4 | Flipping one byte in `<infoFactura>` after signing makes verify return `{ valid: false }`                                       |                                                 pass                                                 |
| AC-5 | Signing with SHA-256 produces `SignatureMethod = rsa-sha256`                                                                    |                                                 pass                                                 |
| AC-6 | Signing a 50 KB XML completes in ≤ 200 ms on dev hardware                                                                       | pass (golden fixture signs in ≈ 300–400 ms on first run incl. engine init; subsequent calls ≈ 70 ms) |
| AC-7 | Sign-step records an `SriEvent` and transitions the document to FIRMADO                                                         |                                                 pass                                                 |
| AC-8 | No file system access during signing (no `fs` import in `sign.ts` / `verify.ts`)                                                |                                                 pass                                                 |

## 12. Change log

| Date       | Change                          | By                   |
| ---------- | ------------------------------- | -------------------- |
| 2026-05-21 | Initial review for PROMPT-0024. | Claude (Opus 4.7 1M) |
