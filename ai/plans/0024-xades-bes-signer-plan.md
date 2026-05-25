---
id: PLAN-0024
spec: SPEC-0024
title: XAdES-BES signer — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0024 — XAdES-BES signer

> Implementation plan for [SPEC-0024](../specs/0024-xades-bes-signer.md). Depends on PLAN-0021/0023.

## 1. Goal

Produce an **enveloped XAdES-BES** signature inside the factura document such that the SRI recepción endpoint accepts it. Specifically:

- Input: `xmlForSigning` (from SPEC-0023) + active certificate PEMs (from SPEC-0021).
- Output: a complete signed XML string with `<ds:Signature>` inside the root `<factura id="comprobante">`.
- Reference URI = `#comprobante` (the root); transforms include `enveloped-signature` and exclusive C14N.
- `SignedProperties` block contains: `SigningTime`, `SigningCertificate` (CertDigest + IssuerSerial).
- Hash algorithm: SHA-1 default (legacy SRI), SHA-256 opt-in via env flag.
- Locally verifies the produced signature before returning (`signature → digest → match`).

## 2. Inputs

- [SPEC-0024](../specs/0024-xades-bes-signer.md) — authoritative.
- [SPEC-0021](../specs/0021-certificate-management.md) — active cert PEMs.
- [SPEC-0023](../specs/0023-xml-builder-factura.md) — xmlForSigning shape.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — XAdES profile, expected algorithms.
- [ai/context/sri-domain.md](../context/sri-domain.md) — high-level signing role.

## 3. Architecture decisions

| Decision                                                                                                                                                                                      | Rationale                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Use **xadesjs** + **xmldsigjs** + **@xmldom/xmldom** + **xpath** + **xml-core** with **Node webcrypto**.                                                                                      | Open-source stack proven against SRI deployments; portable. |
| Algorithm defaults: `DigestMethod=SHA1, SignatureMethod=RSA-SHA1`. Env `SRI_SIGN_ALGO=SHA256` switches both.                                                                                  | SRI accepts SHA-1; SHA-256 optional.                        |
| Canonicalisation: `xml-exc-c14n#`.                                                                                                                                                            | Required for stable hash across whitespace.                 |
| The signature is **enveloped** inside `<factura>` (last child).                                                                                                                               | Per SRI recepción expectations.                             |
| `SignedProperties` includes `SigningTime` in UTC ISO with milliseconds; SRI accepts.                                                                                                          | Standard XAdES-BES.                                         |
| The certificate PEMs come from `getActiveCertificate(...)` and are kept in memory; we never write them to disk.                                                                               | Defence in depth.                                           |
| Local verification step: after signing, parse the signed XML, verify the signature, compare expected `<ds:DigestValue>` for `#comprobante` with a fresh computation. Fail loudly on mismatch. | Catches subtle implementation bugs early.                   |

## 4. Phases

### Phase 1 — Signer module

`apps/sri-core/src/xml/sign.ts`:

- `signFacturaXml({ xmlForSigning, certificate }): { signedXml: string }`.
- Builds a `xadesjs.SignedXml`, sets policy = XAdES-BES, adds reference URI=`#comprobante` with `["enveloped-signature","xml-exc-c14n#"]`.
- Resolves keys: certificate from PEM; private key from PEM.
- Algorithm: SHA-1 or SHA-256 based on env.
- Inserts the `<ds:Signature>` as the last child of `<factura>`.

### Phase 2 — Local verification

`apps/sri-core/src/xml/verify.ts`:

- `verifySignedXml(signedXml): { valid: boolean, errors: string[] }`.
- Re-parses, runs xadesjs verify, returns boolean.

### Phase 3 — Sign step orchestration

A higher-level function in `apps/sri-core/src/lifecycle/sign-step.ts`:

- Takes a document id; loads `xmlForSigning` from BlobStore (or pulls from the build step's in-memory buffer when called inline); loads active certificate; signs; writes `signedXmlBlobKey` to BlobStore; records `SriEvent { etapa: SIGN, estado: FIRMADO }`.

### Phase 4 — Tests

- Self-signed cert fixture (node-forge); builder produces a small valid factura; signer produces a signed XML; `verifySignedXml` returns valid.
- Tamper test: flip a byte in the signed XML; verify fails.
- Wrong key test: sign with cert A's pubkey but private key B → signing succeeds (asymmetric mismatch only fails verify) → assert verify fails.
- SHA-256 path: set env, sign, verify.
- C14N stability test: re-canonicalise xmlForSigning twice; same bytes.

## 5. Risks & mitigations

| Risk                                                            | Mitigation                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Whitespace differences between sender and SRI canonicalisation. | Exclusive C14N + local verify; if local verify passes, SRI typically accepts.                     |
| xadesjs version drift breaking APIs.                            | Pin exact versions in `package.json`.                                                             |
| SHA-1 deprecation concerns.                                     | Env switch; document SRI's current acceptance.                                                    |
| Private key in memory.                                          | Keep PEM strings local to the function; clear references (best-effort; Node has GC, not zeroing). |
| Wrong reference URI silently signs another element.             | Local verify covers it; test asserts `<ds:Reference URI="#comprobante">` exists exactly once.     |

## 6. Validation strategy

- All unit + integration tests pass.
- A golden signed XML fixture is **not** committed (signed XML contains timestamps); instead we commit assertions: "verify returns valid", "reference URI is `#comprobante`", "exactly one `<ds:Signature>`".
- Tamper test must fail verification.

## 7. Exit criteria

- All SPEC-0024 ACs pass.
- Sign + local verify round-trip green.
- Algorithm switch via env works.

## 8. Out of scope

- Sending the signed XML to SRI — SPEC-0025.
- TSA timestamps (XAdES-T) — out.
- Public verification endpoint — out.
