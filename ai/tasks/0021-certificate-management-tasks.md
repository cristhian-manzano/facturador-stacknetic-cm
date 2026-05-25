---
id: TASKS-0021
spec: SPEC-0021
plan: PLAN-0021
title: Certificate management — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0021 — Certificate management

> Checklist for [SPEC-0021](../specs/0021-certificate-management.md) + [PLAN-0021](../plans/0021-certificate-management-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never include `p12CiphertextB64`, `p12NonceB64`, `p12TagB64`, or any decrypted PEM in any API response.
- ❌ Never log the passphrase. Add `passphrase` to REDACT_PATHS if not already.
- ❌ Never persist the passphrase. It enters via multipart, is used once, discarded.
- ✅ All cert mutations require `requireServiceJwt` (sri-core protected route).
- ✅ Active-cert in-memory cache TTL ≤ 5 min and wiped on activate.

## 1. Crypto envelope

- [ ] **1.1** `apps/sri-core/src/crypto/envelope.ts`:
  - `encryptP12(plain: Buffer)`: validates env master key length = 32 bytes; nonce = `randomBytes(12)`; cipher `aes-256-gcm`.
  - `decryptP12({ ciphertext, nonce, tag })`.
  - Returns base64 strings if caller wants — but the public API uses Buffers; conversion in routes.
    **Validate**: unit test encrypts 1 KB random buffer, decrypts, asserts equality byte-for-byte; tampering the tag fails authentication.

## 2. .p12 parser

- [ ] **2.1** `apps/sri-core/src/certificates/parser.ts`:
  - `parseP12(buffer, passphrase)` returns `{ subjectCN, issuerCN, serialHex, validFrom, validTo, fingerprintSha256, certPem, keyPem }`.
  - Implementation: load via `forge.pkcs12.pkcs12FromAsn1(...)`, extract first cert + first key, compute fingerprint via SHA-256 on DER.
  - Throws `BadPassphraseError`, `ExpiredCertificateError`, `ParseError` (mapped to `ProblemDetail` codes).
    **Validate**: unit test with a self-signed `.p12` generated in `beforeAll` via node-forge:
  - good passphrase → returns expected metadata.
  - wrong passphrase → throws `BadPassphraseError`.
  - generate an "already expired" `.p12` (validTo in past) → throws `ExpiredCertificateError`.

## 3. Upload route

- [ ] **3.1** Add multipart middleware to sri-core (e.g., `busboy` or `multer`). Configure max file size 4 MB; reject larger with 413.
      **Validate**: Supertest sends a 5 MB upload, expects 413.

- [ ] **3.2** `POST /v1/certificates` (requires service JWT):
  - Validates body fields via `UploadCertificateSchema`.
  - Calls `parseP12`.
  - Encrypts via `encryptP12`.
  - Inserts row with `status: "INACTIVE"`, fingerprint unique → 409 on duplicate.
  - Audit `cert.uploaded` (companyId, fingerprint, validTo).
  - Response: 201 with metadata only.
    **Validate**: Supertest upload returns 201; body matches `CertificateMetadataSchema`.

## 4. Activate route

- [ ] **4.1** `POST /v1/certificates/:id/activate`:
  - In a Prisma transaction: set this cert's `status='ACTIVE'`; set all others for the same companyId to `INACTIVE`.
  - Invalidate the in-memory active-cert cache for that companyId.
  - Audit `cert.activated` and `cert.deactivated` (for each previously-active cert).
    **Validate**:
  - Upload two certs, activate the first → only the first is ACTIVE.
  - Activate the second → only the second is ACTIVE.
  - `getActiveCertificate(prisma, companyId)` reflects the change immediately.

## 5. List & delete routes

- [ ] **5.1** `GET /v1/certificates`: returns rows scoped to `companyId` from JWT, metadata only.
      **Validate**: response body contains `subjectCN`, `issuerCN`, `validFrom`, `validTo`, `fingerprintSha256`, `status`, `alias` — but NOT any of `p12*` fields.

- [ ] **5.2** `DELETE /v1/certificates/:id`:
  - If `status==='ACTIVE'` → 409 `code: "cannot_delete_active"`.
  - Else delete row; audit.
    **Validate**: deleting ACTIVE fails 409; deleting INACTIVE succeeds 204.

## 6. Active cert helper

- [ ] **6.1** `apps/sri-core/src/certificates/active.ts`:
  - `getActiveCertificate(prisma, companyId)`:
    - LRU cache (capacity 64, TTL 5 min) keyed by `(companyId, fingerprintSha256)`.
    - Cache miss → load row → decrypt → re-parse → cache.
  - `clearActiveCertificateCache(companyId)` called on activate.
    **Validate**: unit test asserts cache hit on second call within TTL; cache miss after `clearActiveCertificateCache`.

## 7. Expiry cron

- [ ] **7.1** `apps/sri-core/src/certificates/expiry-job.ts`:

  - Function `runExpiryCheck(prisma, now = new Date())` is **pure-ish** (logs/audit only).
  - Iterates `Certificate where status='ACTIVE'`; computes `daysRemaining = floor((validTo - now)/86400000)`.
  - For `daysRemaining ∈ {30, 15, 7, 3, 1, 0}`: emit audit `cert.expiry_warning` with `daysRemaining` and log warn.
  - For `daysRemaining < 0`: emit audit `cert.expired` and log error.
    **Validate**: integration test seeds three certs at -1, 5, 31 days; runs `runExpiryCheck`; asserts audit rows match expectations.

- [ ] **7.2** Schedule: at boot, if `NODE_ENV !== "test"`, start a daily timer (or use `node-cron` `"0 6 * * *"`).
      **Validate**: unit test of scheduler boots → invokes `runExpiryCheck` once after a manual tick (mock timers).

## 8. Security hardening

- [ ] **8.1** Add `passphrase` to REDACT_PATHS in `@facturador/logger` if missing.
      **Validate**: redaction test asserts `passphrase` is masked.

- [ ] **8.2** Verify no response in any cert endpoint contains `p12CiphertextB64|p12NonceB64|p12TagB64` keys.
      **Validate**: integration test on each route asserts the response object does not include those keys.

## 9. Negative paths

- [ ] **9.1** Upload with wrong passphrase → 422 with `code: "bad_passphrase"`.
- [ ] **9.2** Upload of duplicate fingerprint → 409 with `code: "conflict"`.
- [ ] **9.3** Upload of expired cert → 422 with `code: "cert_expired"`.
- [ ] **9.4** Activate of nonexistent id → 404.
- [ ] **9.5** Delete of ACTIVE → 409.
- [ ] **9.6** Any cert endpoint without service JWT → 401.
      **Validate**: each path covered by a Supertest case.

## 10. Acceptance criteria

- [ ] AC-1: AES-256-GCM envelope with unique 12-byte nonce per cert.
- [ ] AC-2: Master key validated at boot; service refuses to boot with bad key length.
- [ ] AC-3: `.p12` parsed via node-forge; metadata extracted accurately.
- [ ] AC-4: Atomic activate ensures exactly one ACTIVE cert per tenant.
- [ ] AC-5: API responses never contain ciphertext or PEM material.
- [ ] AC-6: Expiry cron emits warnings at documented intervals.
- [ ] AC-7: Active-cert in-memory cache TTL ≤ 5 min and invalidates on activate.

## 11. Definition of Done

- All boxes ticked; all unit + integration tests green.
- Review file `ai/reviews/0021-certificate-management-review.md` written.
