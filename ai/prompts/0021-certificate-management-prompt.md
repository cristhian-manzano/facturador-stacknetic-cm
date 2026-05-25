---
id: PROMPT-0021
spec: SPEC-0021
plan: PLAN-0021
tasks: TASKS-0021
title: Execute TASKS-0021 — Certificate management
---

# PROMPT-0021 — Execute certificate management

You are an autonomous senior security engineer with deep knowledge of AEAD ciphers, PKCS#12, and X.509. Execute **TASKS-0021**: implement encrypted-at-rest .p12 certificate storage, atomic activation, metadata-only API, and expiry cron — all inside `apps/sri-core`.

---

## 1. Mandatory reading

1. `ai/specs/0021-certificate-management.md` — authoritative.
2. `ai/plans/0021-certificate-management-plan.md`.
3. `ai/tasks/0021-certificate-management-tasks.md`.
4. `ai/specs/0020-sri-core-service-bootstrap.md` — `Certificate` model + service JWT auth.
5. `ai/specs/0006-error-model-and-logging.md` — ProblemDetail, REDACT_PATHS.
6. `ai/context/security.md` — crown jewels invariants.
7. `ai/context/sri-domain.md` — XAdES context (sets expectations for SPEC-0024 consumer).
8. `docs/sri-facturacion-electronica-ecuador.md` — certificate role in SRI scheme.
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only crypto envelope, parser, routes, active helper, and expiry cron as listed in TASKS-0021.
- ❌ Do NOT implement XAdES-BES signing here (SPEC-0024 owns it).
- ❌ Do NOT implement web UI for upload (later spec).
- ❌ Do NOT integrate with KMS / Vault yet (master key from env only; documented follow-up).
- ❌ Do NOT expose `p12*` bytes or any PEM material via API.

## 3. Stack constraints

- Express 5; Prisma 5.
- `node-forge` for PKCS#12 parsing (pure JS, pinned major version).
- `node:crypto` for AES-256-GCM.
- `busboy` or `multer` for multipart; pin and configure with file-size cap.
- `node-cron` (or simple `setInterval` with proper bookkeeping) for daily expiry job.

## 4. Code quality bar

- Envelope returns and accepts only `Buffer`s; routes convert to/from base64 strings at the persistence boundary.
- `parseP12` is small and focused — extraction only; no I/O.
- Active-cert cache uses an LRU with TTL; do not use a manual `Map` without size bounds.
- Activation runs in a Prisma `$transaction` to guarantee at most one ACTIVE per tenant.
- No `any` types in cert code; every input is parsed via Zod or via the parser's typed return.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- Unit tests in `envelope.test.ts`, `parser.test.ts`, `active.test.ts` exit 0.
- Integration tests for upload, activate, list, delete (positive + negative) exit 0.
- A manual smoke (with a synthetic `.p12` fixture generated in test setup) walks: upload → list (only metadata) → activate → `getActiveCertificate` returns PEMs → delete other cert (INACTIVE) succeeds.
- Expiry cron test seeds 3 certs at -1 / 5 / 31 days and asserts the right audit rows appear.

## 6. Security considerations (verbatim from project policy)

- The master key is exactly **32 bytes** (64 hex chars). Boot fails if `SRI_CERT_MASTER_KEY_HEX` doesn't match.
- The passphrase is never persisted and never logged. Add `passphrase` to REDACT_PATHS in `@facturador/logger` if missing.
- The ciphertext is stored alongside the nonce and the GCM auth tag. Tampering must fail decryption (verify with a tampered-tag test case).
- Active cert PEMs live in memory only; the LRU cache TTL is ≤ 5 minutes and is invalidated on activate.
- No API response includes any of: `p12CiphertextB64`, `p12NonceB64`, `p12TagB64`, `certPem`, `keyPem`. The integration tests assert this explicitly.
- Audit rows: `cert.uploaded`, `cert.activated`, `cert.deactivated`, `cert.expiry_warning`, `cert.expired`, `cert.deleted`. Each carries companyId + fingerprint (NEVER the passphrase or any bytes).
- Multipart upload capped at 4 MB; oversize → 413.
- All cert routes are behind `requireServiceJwt`.

## 7. Deliverables

When TASKS-0021 is green, write `ai/reviews/0021-certificate-management-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Encrypt/decrypt round-trip test output (with one tampering case).
   - Parser tests output.
   - Upload → activate → list integration output.
   - Cron test output.
4. **Active-cert cache design** — describe key structure, TTL, eviction behaviour, and how activate invalidates.
5. **Deviations from spec/plan**.
6. **Risks observed** — e.g., master-key rotation procedure; KMS migration; HSM consideration.
7. **Security review** — confirm each item in §6.
8. **Suggested follow-ups** — KMS adapter; email notifications on expiry; web UI for upload.
9. **Sign-off checklist** — SPEC-0021 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; full audit in the review.

## 9. Exit condition

- All TASKS-0021 boxes ticked.
- All tests green; integration smoke proven.
- Review file complete.

Begin.
