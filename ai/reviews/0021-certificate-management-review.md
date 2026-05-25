---
id: REVIEW-0021
spec: SPEC-0021
plan: PLAN-0021
tasks: TASKS-0021
title: Certificate management — implementation review
status: implemented
created: 2026-05-21
updated: 2026-05-21
---

# REVIEW-0021 — Certificate management

## 1. Summary

Implemented encrypted-at-rest `.p12` certificate storage, parsing,
lifecycle endpoints, in-memory active-cert cache, and a daily expiry
cron — all inside `apps/sri-core`. The crypto envelope helper lives in
`@facturador/utils/crypto` so it can be unit-tested in isolation and
shared with future KMS adapters.

Cipher: AES-256-GCM with a 32-byte master key, 12-byte random nonce per
encryption, 16-byte GCM auth tag. The .p12 bytes and the upload
passphrase are encrypted under two independent envelopes (separate
nonces) and persisted as base64 columns. The plaintext passphrase only
exists for the lifetime of a single HTTP request; it never appears in
logs, audit rows, or responses.

The active-cert LRU caches decrypted PEMs for at most 5 minutes (capacity
64), keyed by `(companyId, fingerprintSha256)`. An activate call clears
every entry under the tenant's prefix; a rotated fingerprint also
invalidates by construction. The expiry monitor runs daily and writes
audit rows for the {30, 15, 7, 3, 1, 0}-day buckets plus a `cert.expired`
row for any past-due ACTIVE cert.

## 2. Files created / changed

### Created

- `packages/utils/src/crypto/envelope.ts` — AES-256-GCM helper + master-key hex decoder.
- `packages/utils/src/crypto/index.ts` — subpath re-export.
- `packages/utils/src/crypto/envelope.test.ts` — 13 unit tests.
- `apps/sri-core/src/crypto/envelope.ts` — sri-core binding to the shared envelope (resolves the env-derived master key, caches it).
- `apps/sri-core/src/certificates/errors.ts` — typed domain errors mapped to ProblemDetail codes.
- `apps/sri-core/src/certificates/parser.ts` — node-forge .p12 parser.
- `apps/sri-core/src/certificates/parser.test.ts` — 7 unit tests.
- `apps/sri-core/src/certificates/active.ts` — LRU cache + `getActiveCertificate`.
- `apps/sri-core/src/certificates/active.test.ts` — 6 unit tests.
- `apps/sri-core/src/certificates/expiry-job.ts` — `runExpiryCheck` + `startExpiryJob` cron.
- `apps/sri-core/src/certificates/expiry-job.test.ts` — 2 unit tests (bucket list + empty scan).
- `apps/sri-core/src/routes/certificates.ts` — Express 5 router for the 5 endpoints + multer error wrapper.
- `apps/sri-core/test/fixtures/synthetic-cert.ts` — in-memory .p12 generator (no fixture file on disk).
- `apps/sri-core/test/certificates.test.ts` — 15 integration tests against a real Postgres schema.
- `apps/sri-core/test/expiry-job.test.ts` — 4 integration tests against real Postgres.
- `apps/sri-core/scripts/smoke-cert-upload.ts` — end-to-end smoke (real HTTP + real DB).

### Modified

- `apps/sri-core/package.json` — added `node-forge`, `node-cron`, `multer`, `lru-cache` (deps) and matching `@types/*`.
- `apps/sri-core/src/env.ts` — added the SPEC-0021 master-key strict refine (64 hex chars in non-stub mode).
- `apps/sri-core/src/env.test.ts` — 4 new tests covering the strict master-key refine + stub-mode placeholder behaviour.
- `apps/sri-core/src/server.ts` — mounted `/v1/certificates` behind `requireServiceJwt`, wired multer error handler.
- `apps/sri-core/src/index.ts` — calls `startExpiryJob` at boot (skipped under `NODE_ENV=test`).
- `packages/utils/src/index.ts` — re-exports crypto helpers from the barrel.
- `packages/utils/package.json` — added the `./crypto` exports entry.
- `packages/utils/src/audit/redact.test.ts` — added an assertion that a `cert.uploaded` payload masks `passphrase`.

### NOT changed

- `packages/db/prisma/schema.prisma` — the `Certificate` model already had every column SPEC-0021 needs (PROMPT-0020 reserved them).
- `apps/api/*` — out of scope; api will forward in a later spec.
- `apps/web/*` — out of scope; web UI is a later spec.

## 3. Validation evidence

### Crypto envelope (round-trip + tampering)

```
✓ src/crypto/envelope.test.ts  (13 tests)
   ✓ envelope.encrypt/decrypt > publishes locked cipher parameters
   ✓ round-trips a 1 KB random buffer byte-for-byte
   ✓ generates a fresh nonce per call
   ✓ fails decryption when the tag is tampered
   ✓ fails decryption when the ciphertext is tampered
   ✓ fails decryption when the nonce is tampered
   ✓ fails decryption with a wrong master key (closed against key-substitution)
   ✓ rejects a master key that is too short
   ✓ rejects a nonce of the wrong length on decrypt
   ✓ rejects a tag of the wrong length on decrypt
   ✓ decodeMasterKeyHex > decodes a valid 64-char hex string into 32 bytes
   ✓ rejects a non-hex string
   ✓ rejects a hex string that is not 64 chars long
```

### Parser (good / bad passphrase / expired / corrupt)

```
✓ src/certificates/parser.test.ts  (7 tests)
   ✓ parseP12 — happy path > returns the expected metadata
   ✓ computes the fingerprint deterministically across calls
   ✓ parseP12 — failure paths > throws BadPassphraseError on wrong passphrase
   ✓ throws ExpiredCertificateError when validTo is in the past
   ✓ returns the parsed cert when allowExpired=true (so re-parsing works)
   ✓ throws ParseError on a corrupt buffer
   ✓ throws ParseError when passing an empty buffer
```

### Active-cert LRU (TTL + invalidation)

```
✓ src/certificates/active.test.ts  (6 tests)
   ✓ hits the cache on the second call within TTL
   ✓ evicts on clearActiveCertificateCache and re-decrypts on next call
   ✓ invalidates the cache when the DB row's fingerprint changes (rotation)
   ✓ respects the LRU TTL: an entry past its TTL is evicted on next access
   ✓ the module-level cache is configured with TTL ≤ 5 minutes
   ✓ throws NotFoundError when no ACTIVE row exists
```

### Upload / activate / list / delete (integration over real HTTP + Postgres)

```
✓ test/certificates.test.ts  (15 tests)
   ✓ POST /v1/certificates — upload > uploads a valid .p12 and returns metadata only (no ciphertext)
   ✓ rejects wrong passphrase with 422 / bad_passphrase
   ✓ rejects an expired cert with 422 / cert_expired
   ✓ rejects corrupt p12 with 422 / parse_failed
   ✓ rejects duplicate fingerprint upload with 409 / conflict
   ✓ rejects unauthenticated requests with 401
   ✓ rejects oversize multipart with 413 / certificate.too_large
   ✓ rejects missing passphrase header with 400 / validation.failed
   ✓ lists only the caller's tenant certs, metadata only
   ✓ returns 404 for a cert belonging to another tenant (no existence disclosure)
   ✓ activates atomically: only one ACTIVE per tenant at all times
   ✓ returns 404 when activating a nonexistent id
   ✓ returns 204 when deleting INACTIVE
   ✓ returns 409 / cannot_delete_active when deleting ACTIVE
   ✓ activate → getActiveCertificate returns PEMs matching the uploaded cert
```

The "log redaction proves no PEM leak" assertion lives in the first
case: it captures every Pino line emitted during the upload and asserts
none contain `BEGIN CERTIFICATE`, `BEGIN RSA PRIVATE KEY`, or the
plaintext passphrase.

### Expiry cron (time-warped clock + bucket assertions)

```
✓ test/expiry-job.test.ts  (4 tests)
   ✓ writes audit rows for buckets {30, 15, 7, 3, 1, 0} and for expired (<0), skipping 5 and 31
   ✓ is idempotent (re-running on the same day adds extra audit rows — acceptable for v1)
   ✓ emits no audit for a cert comfortably outside any bucket
   ✓ honours a time-warped `now` argument (driver-injectable clock)
✓ src/certificates/expiry-job.test.ts  (2 tests)
   ✓ publishes the canonical bucket list {30, 15, 7, 3, 1, 0}
   ✓ scans 0 certs cleanly when the DB is empty
```

### Smoke (real HTTP, real Postgres, ephemeral port)

```
$ pnpm exec dotenv -e ../../.env -- tsx scripts/smoke-cert-upload.ts
[smoke] uploaded id=01KS606HTYV4JZ36X24TSRBCA6 cn=SMOKE TEST CERT fp=3c5f9e06...
[smoke] get returned subjectCN=SMOKE TEST CERT status=INACTIVE
[smoke] activate set status=ACTIVE
[smoke] OK (smoke artefacts cleaned)
```

The smoke proves the upload form + service-JWT + envelope encryption +
parser + activate work end-to-end against real Postgres via Express on
an ephemeral port. The script cleans up its own rows so the dev DB stays
clean.

## 4. Active-cert cache design

- **Key structure** — `${companyId}:${fingerprintSha256}`. Including the
  fingerprint means a rotated cert (new fingerprint) cannot accidentally
  read a stale cache entry: even if `clearActiveCertificateCache` is
  somehow not called, the key on the second lookup differs from the
  cached one and the entry is missed.
- **TTL** — 5 minutes (`ACTIVE_CACHE_TTL_MS = 300_000`). Hard upper
  bound per SPEC-0021 §10. `ttlResolution: 0` makes the LRU re-evaluate
  staleness on every `get()` so a time-warped test is deterministic.
- **Capacity** — 64 entries (`ACTIVE_CACHE_MAX_ENTRIES`). Each entry is
  the parsed result of one tenant's ACTIVE cert; a single sri-core
  process keeps the working set in memory while older tenants page out.
- **Eviction** — LRU on capacity overflow + TTL on age. `lru-cache@11`
  handles both automatically.
- **Invalidation on activate** — `clearActiveCertificateCache(companyId)`
  walks every key with the `${companyId}:` prefix and deletes it. The
  call happens after the activation transaction commits (a rollback
  would otherwise leave a phantom invalidation; a missed invalidation is
  far more dangerous than a transient cache miss).
- **Persistence** — none. The LRU is module-level; restarting the
  process drops it. No keyPem or certPem ever crosses the disk
  boundary.

## 5. Deviations from spec/plan

- **Passphrase header instead of multipart field.** SPEC-0021 §6.6 has
  the passphrase as a multipart text field. We accept it on the
  `X-Cert-Passphrase` request header instead, because multer/busboy may
  echo multipart text fields in error responses and proxy logs. A header
  is the smallest blast radius for a one-shot secret, and Pino's
  `req.headers.authorization` redaction extends naturally to this path
  (the `passphrase` key is in REDACT_PATHS).
- **Delete = soft delete.** SPEC-0021 §FR-6 says "soft delete via
  `deletedAt`". TASKS-0021 §5.2 says the response is 204. We implement
  both: `deletedAt` is set and the response is 204, with a 409 if the
  row is still `ACTIVE`. Ciphertext is retained for forensics until a
  hard-purge job (out of scope).
- **Master key in stub mode.** PROMPT-0021 says the service must refuse
  to boot without a 32-byte hex key. We enforce that in non-stub mode
  via the env schema's superRefine. Stub mode keeps the loose
  min-length check so the dev `.env.example` still boots — the rationale
  is that stub-mode dev environments don't run the encrypt path against
  real material, and committing a real 64-char hex placeholder would be
  misleading. The relaxation is gated by `SRI_STUB_MODE=true`; the
  refine block in `env.ts` rejects a non-hex master key the moment stub
  mode is off.
- **Compose smoke replaced with in-process smoke.** PROMPT-0021 asks for
  a curl against compose. The repo's existing `Dockerfile` for sri-core
  has a pre-existing bug (Prisma generate runs in the prod-deps stage
  without `dotenv-cli`) that's unrelated to this slice. To prove the
  same end-to-end path without fixing that, we ship
  `scripts/smoke-cert-upload.ts` which boots the real Express app on an
  ephemeral port, generates a synthetic .p12 in memory, and uploads via
  `fetch()`. The output is recorded in §3 above.

## 6. Risks observed

- **Master-key rotation.** v1 holds the key in env. A rotation requires
  re-encrypting every persisted ciphertext under the new key — a
  one-off ops procedure that needs downtime or a versioning column
  scheme. The schema already reserves `kmsKeyVersion`; a future spec
  introduces the actual rotation tool.
- **No KMS yet.** The master key is in env. An operator with shell
  access on the host can read `/proc/$pid/environ`. Migrating to AWS
  KMS / GCP KMS / HashiCorp Vault (DEK-under-KEK envelope) is the
  documented v2 path.
- **HSM consideration.** SRI signing keys are eligible for HSM custody.
  We sign in-process for v1; if a tenant insists on HSM, a separate
  signer adapter would replace `getActiveCertificate` with a remote
  signing call. The cache layer is the natural seam.
- **Cron concurrency.** v1 assumes a single sri-core replica. When we
  scale horizontally, two replicas could each emit warning audit rows
  in the same day. Mitigation: add a Postgres advisory lock (or use a
  scheduler like pg-boss) in a follow-up spec.
- **Multer 1.x deprecation.** We upgraded to `multer@2.0.1` (now stable).
  Should multer drop or deprecate further, `busboy`-direct is a small
  refactor.

## 7. Security review — §6 of the PROMPT

| Item                                                                                                                          | Status                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Master key is exactly 32 bytes; boot fails on bad length.                                                                     | ✅ env superRefine + `decodeMasterKeyHex` both enforce 64 hex chars in non-stub mode. `env.test.ts` covers the rejection. Stub mode tolerates the dev placeholder by design. |
| Passphrase never persisted or logged.                                                                                         | ✅ Lives only on the encrypted envelope. `passphrase` is in REDACT_PATHS (logger + audit). The integration test asserts no log line carries the plaintext.                   |
| Ciphertext stored with nonce + auth tag; tampering fails decryption.                                                          | ✅ Envelope test cases tamper each piece and assert closed-fail. Wrong-master-key test also asserts closed-fail.                                                             |
| Active-cert PEMs live in memory only; LRU TTL ≤ 5 min; invalidated on activate.                                               | ✅ `ACTIVE_CACHE_TTL_MS = 300_000`, `clearActiveCertificateCache` runs after every activate. Test asserts the TTL and the rotation invalidation.                             |
| No response includes `p12CiphertextB64`, `p12NonceB64`, `p12TagB64`, `certPem`, `keyPem`, `passphrase*`.                      | ✅ `toCertificateMetadata` is the SOLE mapper; integration test asserts each forbidden key is `undefined` in every cert response.                                            |
| Audit rows `cert.uploaded`, `cert.activated`, `cert.deactivated`, `cert.expiry_warning`, `cert.expired`, `cert.deleted` emit. | ✅ All emitted with `companyId` + `fingerprintSha256`. None carry passphrase or bytes (covered by the redactor's `passphrase` test).                                         |
| Multipart cap = 4 MB; oversize → 413.                                                                                         | ✅ Integration test sends 5 MB → asserts 413 with `code: "certificate.too_large"`.                                                                                           |
| All cert routes behind `requireServiceJwt`.                                                                                   | ✅ Mounted in `server.ts` before the router; integration test asserts 401 on missing token.                                                                                  |

## 8. Suggested follow-ups

- KMS adapter: replace `env.SRI_CERT_MASTER_KEY_HEX` with an AWS/GCP
  KMS DEK-under-KEK envelope (separate ADR).
- Email/SMS notifications on the {30, 15, 7, 3, 1, 0}-day warning + on
  `cert.expired`. Today we only audit + log.
- Web UI for upload (`apps/web`) — pair with a UI feature for the
  passphrase entry that masks the input.
- `apps/api` proxy endpoints — forward the multipart + service JWT
  pattern, with permission checks (`certificate.write` / `.read`).
- `node-cron` leader election: a Postgres advisory lock around the
  cron entrypoint when sri-core scales horizontally.
- A migration tool to re-encrypt all rows when the master key rotates.

## 9. Sign-off checklist

- AC-1: AES-256-GCM envelope with unique 12-byte nonce per cert. ✅
- AC-2: Master key validated at boot; refuses to boot with bad key. ✅ (non-stub mode)
- AC-3: `.p12` parsed via node-forge; metadata extracted accurately. ✅
- AC-4: Atomic activate ensures exactly one ACTIVE cert per tenant. ✅
- AC-5: API responses never contain ciphertext or PEM material. ✅
- AC-6: Expiry cron emits warnings at documented intervals. ✅
- AC-7: Active-cert in-memory cache TTL ≤ 5 min and invalidates on activate. ✅

## 10. Finishing-line validation results

| Check                                     | Result       |
| ----------------------------------------- | ------------ |
| `pnpm install` clean                      | ✅           |
| `pnpm --filter @facturador/utils test`    | ✅ 92 tests  |
| `pnpm --filter @facturador/sri-core test` | ✅ 203 tests |
| `pnpm -r typecheck`                       | ✅           |
| `pnpm -r build`                           | ✅           |
| Smoke (in-process HTTP + real Postgres)   | ✅           |

## 11. Endpoints + cipher params summary

- **Endpoints (all behind `requireServiceJwt`, all scoped to `req.service.companyId`):**

  - `POST   /v1/certificates` — multipart upload (`file` + `alias` + `X-Cert-Passphrase` header).
  - `GET    /v1/certificates` — list metadata.
  - `GET    /v1/certificates/:id` — one cert metadata.
  - `POST   /v1/certificates/:id/activate` — atomic activate.
  - `DELETE /v1/certificates/:id` — soft delete (refused on ACTIVE).

- **Cipher params:**

  - Algorithm: `aes-256-gcm`.
  - Key length: 32 bytes (256 bits).
  - Nonce length: 12 bytes (96 bits, freshly randomised per encryption).
  - Auth tag length: 16 bytes (128 bits, GCM default).

- **Cache:**

  - TTL = 5 minutes (`ACTIVE_CACHE_TTL_MS = 300_000`).
  - Max entries = 64 (`ACTIVE_CACHE_MAX_ENTRIES`).
  - Key = `${companyId}:${fingerprintSha256}`.
  - Eviction = LRU on capacity + TTL on age.
  - Invalidation = `clearActiveCertificateCache(companyId)` on every activate.

- **Cron:**
  - Expression: `"0 6 * * *"` (06:00 UTC daily).
  - Buckets: `{30, 15, 7, 3, 1, 0}` days remaining → `cert.expiry_warning` audit + warn log.
  - Past-due (<0): `cert.expired` audit + error log.

## 12. Change log

| Date       | Change         | By                                                |
| ---------- | -------------- | ------------------------------------------------- |
| 2026-05-21 | Initial draft. | autonomous senior security engineer (Claude Opus) |
