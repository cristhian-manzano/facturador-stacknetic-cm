---
id: PROMPT-0024
spec: SPEC-0024
plan: PLAN-0024
tasks: TASKS-0024
title: Execute TASKS-0024 — XAdES-BES signer
---

# PROMPT-0024 — Execute XAdES-BES signer

You are an autonomous senior cryptography / XML-DSig engineer with hands-on XAdES experience. Execute **TASKS-0024**: implement enveloped XAdES-BES signing for the SRI factura, local signature verification, and lifecycle wiring.

---

## 1. Mandatory reading

1. `ai/specs/0024-xades-bes-signer.md` — authoritative.
2. `ai/plans/0024-xades-bes-signer-plan.md`.
3. `ai/tasks/0024-xades-bes-signer-tasks.md`.
4. `ai/specs/0023-xml-builder-factura.md` — `xmlForSigning` shape.
5. `ai/specs/0021-certificate-management.md` — `getActiveCertificate` provides PEMs.
6. `docs/sri-facturacion-electronica-ecuador.md` — XAdES profile expected by SRI.
7. `ai/context/sri-domain.md` — high-level signing role.
8. `ai/specs/0020-sri-core-service-bootstrap.md` — `SriEvent` model.
9. `ai/specs/0026-document-lifecycle-and-jobs.md` — lifecycle states.
10. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only signing + verification + lifecycle sign-step.
- ❌ Do NOT send to SRI (SPEC-0025).
- ❌ Do NOT introduce XAdES-T (TSA) timestamps.
- ❌ Do NOT accept cert/private key from any request body — must come from the active-cert helper.

## 3. Stack constraints

- `xadesjs`, `xmldsigjs`, `@xmldom/xmldom`, `xpath`, `xml-core`, Node `crypto.webcrypto`.
- Pin major + minor versions exactly.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Exactly one Signature element; reference URI exactly `#comprobante`; transforms exactly `[enveloped-signature, xml-exc-c14n#]`.
- Local verification runs **inside** `signFacturaXml` and throws if the produced signature does not verify against the embedded cert.
- The `SignedProperties` block is generated deterministically except for `SigningTime` (which is fresh on each call — document this in the review file).
- No imports of `fs` in `sign.ts` / `verify.ts`. Blob persistence belongs to the lifecycle layer.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/sri-core test --coverage` exits 0; coverage on signer files ≥ 85%.
- Round-trip test (sign → verify) is green.
- Tamper test fails verification.
- Wrong-key test fails verification.
- SHA-256 path produces the expected algorithm URIs.
- Exactly one `<ds:Signature>` and exactly one `<ds:Reference URI="#comprobante">` in the output.
- Sign-step integration test transitions the document to FIRMADO and records an `SriEvent`.

## 6. Security considerations

- Private key PEM is held only in local variables; never logged, never returned, never persisted.
- Signed XML may contain customer PII — do NOT log the full body. Logger redacts `signedXml` already.
- Algorithm selection is server-side (`env.SRI_SIGN_ALGO`); never accepted from a request.
- The cert/issuer info in `SigningCertificate` must be sourced from the actual cert bytes — do not stub.
- After signing, the produced XML is the only artefact persisted; the in-memory PEMs may be released to GC.

## 7. Deliverables

When TASKS-0024 is green, write `ai/reviews/0024-xades-bes-signer-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage report on `sign.ts` / `verify.ts`.
   - Test outputs for round-trip, tamper, wrong-key, SHA-256.
   - A snippet of the produced `<ds:Signature>` (algorithm URIs visible; truncate the digest/value bodies).
4. **Algorithm matrix** — SHA-1 vs SHA-256: which URIs in DigestMethod, SignatureMethod.
5. **Determinism analysis** — what is non-deterministic (SigningTime) and why it's acceptable.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., upstream xadesjs API churn; potential whitespace traps with C14N.
8. **Security review** — confirm key handling, no logging, algorithm pinned server-side.
9. **Suggested follow-ups** — Move to XAdES-T with TSA; benchmark SHA-256 cost; add ECDSA support if SRI ever permits.
10. **Sign-off checklist** — SPEC-0024 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; detailed review.

## 9. Exit condition

- All TASKS-0024 boxes ticked.
- Round-trip / tamper / wrong-key / SHA-256 tests all green.
- Review file complete.

Begin.
