---
id: TASKS-0024
spec: SPEC-0024
plan: PLAN-0024
title: XAdES-BES signer — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0024 — XAdES-BES signer

> Checklist for [SPEC-0024](../specs/0024-xades-bes-signer.md) + [PLAN-0024](../plans/0024-xades-bes-signer-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never write the private key to disk, log, or response.
- ❌ Never accept the certificate/private key from a request body or query parameter. Always pulled from `getActiveCertificate(prisma, companyId)`.
- ❌ Never skip local verification of the produced signature.
- ✅ Reference URI is exactly `#comprobante`; transforms are `enveloped-signature` then `xml-exc-c14n#` in that order.
- ✅ Algorithm: SHA-1 default; SHA-256 only when `SRI_SIGN_ALGO=SHA256`.

## 1. Dependencies

- [ ] **1.1** Add to `apps/sri-core/package.json`:

  - `xadesjs@^2`
  - `xmldsigjs@^2`
  - `@xmldom/xmldom@^0.8`
  - `xpath@^0.0.34`
  - `xml-core@^1`
  - (Pin exact versions.)
    **Validate**: `pnpm install` succeeds; `node -e "require('xadesjs')"` from sri-core succeeds.

- [ ] **1.2** Wire Node webcrypto into xadesjs at module load (the standard `Application.setEngine("NodeJS", crypto.webcrypto)` or equivalent for the version chosen).
      **Validate**: unit test imports `xadesjs.SignedXml` and constructs an empty instance without throwing.

## 2. Signer

- [ ] **2.1** `apps/sri-core/src/xml/sign.ts`:
  - `signFacturaXml({ xmlForSigning, certificate: { certPem, keyPem }, algo? })` returns `{ signedXml }`.
  - Configure: digest + signature method by `algo` (SHA-1 default).
  - Add a Reference with URI `#comprobante`, transforms `[enveloped-signature, xml-exc-c14n#]`.
  - Insert `<ds:Signature>` as the LAST child of `<factura>`.
  - Include `SignedProperties` with `SigningTime` (UTC ISO ms) and `SigningCertificate` (CertDigest + IssuerSerial).
    **Validate**: see §4.

## 3. Local verifier

- [ ] **3.1** `apps/sri-core/src/xml/verify.ts`:
  - `verifySignedXml(signedXml): { valid, errors }` parses with @xmldom, finds `<ds:Signature>`, runs xadesjs `Verify(...)` against the signing certificate embedded in `KeyInfo`.
    **Validate**: see §4.

## 4. Round-trip tests

- [ ] **4.1** Test setup generates a synthetic `.p12` (node-forge), unwraps to PEMs.

- [ ] **4.2** Build a synthetic factura XML (use the SPEC-0023 builder), sign it, verify it.
      **Validate**: `verify.valid === true`.

- [ ] **4.3** Tamper test: change one character in the signed XML body (outside the `<ds:Signature>` block).
      **Validate**: `verify.valid === false`.

- [ ] **4.4** Wrong-key test: sign with private key X; replace `KeyInfo` certificate with cert Y (random other cert).
      **Validate**: `verify.valid === false`.

- [ ] **4.5** SHA-256 test: set `SRI_SIGN_ALGO=SHA256`, sign + verify; the produced XML uses `xmldsig#rsa-sha256` and `xmlenc#sha256`.
      **Validate**: regex on the signed XML for the algorithm URIs; verify true.

- [ ] **4.6** Single-signature invariant: assert the signed XML contains **exactly one** `<ds:Signature>`.
      **Validate**: regex count = 1.

- [ ] **4.7** Reference URI invariant: assert `<ds:Reference URI="#comprobante">` exists exactly once.
      **Validate**: regex count = 1.

## 5. Sign step (lifecycle wiring)

- [ ] **5.1** `apps/sri-core/src/lifecycle/sign-step.ts`:
  - Pull document by id; load `xmlForSigning` (interim: passed in by caller from the build step; SPEC-0026 will formalise the BlobStore).
  - Load active certificate.
  - Sign; verify locally.
  - On success: write `signedXml` to BlobStore (filesystem in dev — placeholder OK if BlobStore interface is stubbed) and update `SriDocument.signedXmlBlobKey`.
  - Record `SriEvent { etapa: SIGN, estado: FIRMADO, durationMs }`.
    **Validate**: integration test creates a PENDIENTE document, runs sign-step, asserts new state FIRMADO + event row.

## 6. Coverage

- [ ] **6.1** `pnpm --filter @facturador/sri-core test --coverage` shows ≥ 85% statements on `xml/sign.ts` and `xml/verify.ts`.
      **Validate**: pass.

## 7. Acceptance criteria

- [ ] AC-1: Signed XML contains exactly one `<ds:Signature>` enveloped in `<factura>`.
- [ ] AC-2: Reference URI is `#comprobante` with transforms `[enveloped-signature, xml-exc-c14n#]`.
- [ ] AC-3: SHA-1 default; SHA-256 via env.
- [ ] AC-4: Local verify returns valid for a freshly signed XML.
- [ ] AC-5: Tampering or wrong-key replacement causes verify to fail.
- [ ] AC-6: Private key never leaves memory; never logged.
- [ ] AC-7: Sign-step records an `SriEvent` and transitions the document to FIRMADO.

## 8. Definition of Done

- All boxes ticked; all tests green; coverage ≥ 85% on signer files.
- Review file `ai/reviews/0024-xades-bes-signer-review.md` written.
