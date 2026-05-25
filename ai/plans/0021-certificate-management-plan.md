---
id: PLAN-0021
spec: SPEC-0021
title: Certificate management — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0021 — Certificate management

> Implementation plan for [SPEC-0021](../specs/0021-certificate-management.md). Depends on PLAN-0020.

## 1. Goal

Allow uploading and rotating SRI `.p12` certificates inside `apps/sri-core`. After this slice:

- A multipart upload endpoint accepts a `.p12` + passphrase, parses metadata (subject CN, issuer CN, serial, validFrom/To, fingerprint), encrypts the bytes with AES-256-GCM envelope, and stores ciphertext + nonce + tag in the `Certificate` row.
- An "activate" endpoint atomically marks a certificate as ACTIVE and deactivates the previous one for the same tenant.
- A "list" endpoint returns metadata only (NEVER ciphertext).
- An expiry alert cron logs warnings at 30 / 15 / 7 days remaining, then daily after 0 days.
- A pure helper `getActiveCertificate(prisma, companyId)` returns the in-memory `{ privateKeyPem, certificatePem, subjectCN }` for signing — used by SPEC-0024.

## 2. Inputs

- [SPEC-0021](../specs/0021-certificate-management.md) — authoritative.
- [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md) — `Certificate` model.
- [SPEC-0006](../specs/0006-error-model-and-logging.md) — REDACT_PATHS must already mask cert paths.
- [ai/context/security.md](../context/security.md) — crown jewels: certs never leave sri-core.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                                                              | Rationale                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **AES-256-GCM** envelope encryption. Master key from `SRI_CERT_MASTER_KEY_HEX` (64 hex chars = 32 bytes).                                                                                                                                             | NIST-approved AEAD; integrity + confidentiality in one. |
| Random **12-byte nonce** per certificate. Stored alongside ciphertext + auth tag.                                                                                                                                                                     | Required for GCM uniqueness.                            |
| Master key in env for v1; documented follow-up to move to KMS (AWS KMS / GCP KMS / HashiCorp Vault).                                                                                                                                                  | Pragmatic v1; documented risk.                          |
| `.p12` parsed with **node-forge**. Extract `cert.pem` + `key.pem` once during upload (validation); discard plaintext; only the original `.p12` bytes are encrypted at rest. Decryption (when needed for signing) re-parses with node-forge in-memory. | One canonical store; no plaintext PEMs persisted.       |
| Atomic activate: a single SQL `UPDATE ... SET status=CASE WHEN id=$id THEN 'ACTIVE' ELSE 'INACTIVE' END WHERE companyId=$cid` (or in a Prisma transaction).                                                                                           | No window where two certs are ACTIVE simultaneously.    |
| Fingerprint = SHA-256 of the DER cert; stored to detect re-uploads.                                                                                                                                                                                   | `@@unique` on `fingerprintSha256` rejects duplicates.   |
| Validity check on upload: `validFrom <= now <= validTo`; reject otherwise (configurable: allow upload of an expired cert? Default no.).                                                                                                               | Avoid uploading already-expired cards.                  |
| Passphrase never persisted. It's used once to parse the `.p12`; the encrypted blob retains the same passphrase-protected `.p12` form (do **not** re-encrypt the inner keys).                                                                          | Keeps the artifact verifiable later if needed.          |
| Cron job once a day; if any active cert is within 30/15/7 days of expiry or expired, log + write an audit row + (later spec) send an email.                                                                                                           | Avoid surprise outages.                                 |

## 4. Phases

### Phase 1 — Crypto envelope

`apps/sri-core/src/crypto/envelope.ts`:

- `encryptP12(p12Bytes: Buffer): { ciphertext: Buffer, nonce: Buffer, tag: Buffer }`.
- `decryptP12({ ciphertext, nonce, tag }): Buffer`.
- Master key read from env, validated to be 32 bytes hex.
- AES-256-GCM via `node:crypto.createCipheriv`.

### Phase 2 — .p12 parser

`apps/sri-core/src/certificates/parser.ts`:

- `parseP12(buffer, passphrase): { subjectCN, issuerCN, serialHex, validFrom, validTo, fingerprintSha256, certPem, keyPem }`.
- Uses node-forge.
- Throws domain-specific errors (`BAD_PASSPHRASE`, `EXPIRED`, `PARSE_ERROR`).

### Phase 3 — Routes

`apps/sri-core/src/routes/certificates.ts`:

- `POST /v1/certificates` (multipart): fields `file` (the .p12) + `passphrase` + `alias`. Validates via Zod (`UploadCertificateSchema`), encrypts, inserts row with `status: "INACTIVE"`. Returns metadata only.
- `POST /v1/certificates/:id/activate`: activates this cert + deactivates others in the same tenant atomically. Audit `cert.activated`.
- `GET /v1/certificates`: list (metadata only, NO bytes).
- `DELETE /v1/certificates/:id`: removes (or soft-deletes if ACTIVE — refuse with 409).

### Phase 4 — Active cert helper

`apps/sri-core/src/certificates/active.ts`:

- `getActiveCertificate(prisma, companyId): Promise<{ certPem, keyPem, subjectCN, expiresAt }>`.
- Loads the ACTIVE row, decrypts, re-parses with node-forge, returns in-memory PEMs.
- Caches per-process for ≤ 5 minutes (LRU + TTL) keyed by `(companyId, fingerprint)` to amortise crypto cost; cache cleared on activate.

### Phase 5 — Expiry cron

`apps/sri-core/src/certificates/expiry-job.ts`:

- Runs once a day (`node-cron` or simple interval scheduler).
- For each ACTIVE cert: compute days remaining; if in {30,15,7,…,0,-1…}: emit audit `cert.expiry_warning` + log warn line.
- Idempotent within a day: a `lastWarningAt` field could be added, but for v1 the cron runs daily and logs each day; idempotency is enforced by daily granularity.

### Phase 6 — Tests

- Unit:
  - envelope round-trip (encrypt → decrypt = identity).
  - parser happy path with a synthetic `.p12` fixture (generated at test setup using node-forge with a self-signed cert).
  - parser failure paths.
  - activate logic: two certs, calling activate flips exactly one.
- Integration:
  - upload via Supertest with the synthetic `.p12` fixture multipart.
  - activate via Supertest.
  - list returns metadata only; ciphertext not in the response.
  - delete on ACTIVE returns 409.

## 5. Risks & mitigations

| Risk                                    | Mitigation                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Master key compromise.                  | Documented procedure: rotate by re-encrypting every cert with new key (downtime acceptable; one-off ops task). |
| Memory cache leaks active key material. | TTL ≤ 5 min; LRU cap; cache wiped on activate.                                                                 |
| Two ACTIVE certs simultaneously.        | Activation in a transaction; integration test asserts exactly one ACTIVE.                                      |
| Forge native ABI breakage.              | node-forge is pure JS; no native deps.                                                                         |
| Multipart upload size attacks.          | Cap body size at 4 MB; reject larger.                                                                          |
| Passphrase logged accidentally.         | Add `passphrase` to REDACT_PATHS; ensure form-handling library doesn't echo.                                   |

## 6. Validation strategy

- All tests pass; coverage on `crypto/envelope.ts`, `certificates/parser.ts`, `certificates/active.ts` ≥ 95%.
- Supertest scenarios for upload → list → activate → list → delete.
- Negative: bad passphrase → 422 with `code: "bad_passphrase"`; expired cert (test fixture) → 422 `code: "cert_expired"`.

## 7. Exit criteria

- All SPEC-0021 ACs pass.
- No certificate bytes leave sri-core via any response.
- Active cert helper provides PEMs in-memory only.

## 8. Out of scope

- Web UI for upload — separate spec.
- KMS integration — separate spec.
- Notification (email/SMS) for expiry — depends on later mailer spec.
- Hardware tokens / HSM — out.
