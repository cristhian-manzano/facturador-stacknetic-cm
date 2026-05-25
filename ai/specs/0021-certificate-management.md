---
id: SPEC-0021
title: Certificate management (.p12 storage and lifecycle)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0011, SPEC-0020]
blocks: [SPEC-0024, SPEC-0026, SPEC-0033]
---

# SPEC-0021 — Certificate management

## 1. Purpose

Securely accept tenant-uploaded `.p12` certificates, store them encrypted at rest, decrypt them in memory only at signing time, and expose the rest of SRI Core to **just** what's needed (the active cert per tenant, ready to sign). Certificates are the highest-value secret in the platform — see [`ai/context/security.md`](../context/security.md) §1.

## 2. Scope

### 2.1 In scope

- Upload endpoint (lives in `apps/api`; forwards to SRI Core).
- Storage in `Certificate` table (defined in [SPEC-0020](./0020-sri-core-service-bootstrap.md) §6.4).
- AES-256-GCM envelope encryption with a master key sourced from env (dev) / KMS (prod). Version tag stored alongside.
- Parsing `.p12` to extract metadata (subject DN, serial, validity) **without** persisting the decrypted private key.
- Lifecycle: ACTIVE / INACTIVE / EXPIRED / REVOKED. Only one ACTIVE per tenant at a time.
- Rotation: uploading a new ACTIVE deactivates the previous.
- Expiry alerts: a daily job logs (and audits) when ACTIVE certs are within 30/15/7 days of expiry.
- Read-only endpoint for cert metadata: `GET /api/v1/certificates` and `GET /api/v1/certificates/:id` (no private material returned, ever).

### 2.2 Out of scope

- KMS integration (env-key in dev; real KMS in a deployment spec).
- HSM / cloud-signer (we sign in-process).
- Certificate revocation list checking (not required by SRI for signing; out of scope).
- Multi-cert per tenant (one ACTIVE; INACTIVE history kept).

## 3. Context & references

- [`ai/context/security.md`](../context/security.md) — crown jewels.
- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §2 — certificate requirements.
- [SPEC-0006](./0006-error-model-and-logging.md) — redactions block any accidental leak.
- [SPEC-0020](./0020-sri-core-service-bootstrap.md) — `Certificate` model.
- [SPEC-0024](./0024-xades-bes-signer.md) — consumes the decrypted material.

## 4. Functional requirements

- **FR-1.** Upload flow:
  - `POST /api/v1/certificates` (API, multipart/form-data: `file` `.p12`, `passphrase`, `alias`).
  - Permission: `certificate.write`.
  - API forwards the file + passphrase to `POST /v1/certificates` on SRI Core over HTTPS with a service JWT.
  - SRI Core: parse, validate (not expired, `notBefore` < now, RSA key present), encrypt, persist as `INACTIVE` initially.
  - Returns metadata (no secret bytes).
- **FR-2.** Activation:
  - `POST /api/v1/certificates/:id/activate` (API → SRI Core). Atomically sets target `ACTIVE`, prior `ACTIVE` → `INACTIVE`. Audited.
- **FR-3.** Listing:
  - `GET /api/v1/certificates` returns metadata: id, alias, serial, subject, issuer, validFrom, validTo, status. Per active tenant.
- **FR-4.** Decryption surface (internal to SRI Core only):
  - `loadActiveCertForSigning(companyId): Promise<{ privateKey, certPemBase64, expiresAt }>`.
  - Must not be exported beyond `apps/sri-core/src/certificates/`.
  - Decrypts on every call (no in-memory caching for v1, to support fast revocation).
- **FR-5.** Expiry job:
  - Cron-like daily task (in process, scheduled by SRI Core; library `node-cron` or a simple `setInterval` with leader-election deferred).
  - Emits audit events `certificate.expiring_soon_30`, `_15`, `_7` and `certificate.expired`.
- **FR-6.** Deletion:
  - Soft delete via `deletedAt`. Even soft-deleted rows retain ciphertext (for forensics) until a hard-purge job runs (out of scope).

## 5. Non-functional requirements

- **NFR-1.** Upload `.p12` ≤ 200 KB hard cap; reject larger.
- **NFR-2.** Encrypt + persist ≤ 250 ms.
- **NFR-3.** `loadActiveCertForSigning` ≤ 100 ms.
- **NFR-4.** Zero plaintext private-key material in DB, logs, or error responses.

## 6. Technical design

### 6.1 Encryption envelope

- **Algorithm:** AES-256-GCM.
- **Master key:** 32 bytes. Dev: `SRI_CERT_MASTER_KEY_HEX` env. Prod: a KMS-backed key (later spec).
- **Per-record nonce:** 12 random bytes.
- **Stored fields:**
  - `encryptedP12 = nonce || authTag || ciphertext` (bytes concatenated).
  - `encryptedPass = nonce || authTag || ciphertext` (separate envelope).
  - `kmsKeyVersion = "v1"` (placeholder for future rotation).
- **Encrypt fn:**

  ```ts
  // apps/sri-core/src/certificates/crypto.ts
  import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
  import { env } from "../env.js";

  const key = Buffer.from(env.SRI_CERT_MASTER_KEY_HEX, "hex"); // 32 bytes
  if (key.length !== 32) throw new Error("SRI_CERT_MASTER_KEY_HEX must be 32 bytes hex");

  export const encrypt = (plain: Buffer): Buffer => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, ct]);
  };

  export const decrypt = (envelope: Buffer): Buffer => {
    const nonce = envelope.subarray(0, 12);
    const tag = envelope.subarray(12, 28);
    const ct = envelope.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  };
  ```

### 6.2 Parsing `.p12`

Use `node-forge`. Extract:

- Certificate (X.509).
- Private key (PKCS#8).
- Compute SHA-256 over the cert DER; store as `serialNumber` only — keep the **forge cert serial** (decimal/hex) too. Choose one canonical representation and document it.

```ts
import forge from "node-forge";

export interface ParsedP12 {
  certPem: string; // PEM-encoded X.509 (no leading BEGIN/END can be reattached if needed)
  privateKeyPem: string; // PEM-encoded PKCS#8 private key
  serialHex: string;
  subjectDn: string;
  issuerDn: string;
  validFrom: Date;
  validTo: Date;
}

export const parseP12 = (p12Bytes: Buffer, passphrase: string): ParsedP12 => {
  const der = forge.util.binary.raw.encode(new Uint8Array(p12Bytes));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ]?.[0];
  if (!certBag?.cert || !keyBag?.key) throw new Error("Invalid PKCS#12: missing cert or key");

  return {
    certPem: forge.pki.certificateToPem(certBag.cert),
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey),
    serialHex: certBag.cert.serialNumber, // already hex string
    subjectDn: certBag.cert.subject.attributes
      .map((a) => `${a.shortName ?? a.type}=${a.value}`)
      .join(", "),
    issuerDn: certBag.cert.issuer.attributes
      .map((a) => `${a.shortName ?? a.type}=${a.value}`)
      .join(", "),
    validFrom: certBag.cert.validity.notBefore,
    validTo: certBag.cert.validity.notAfter,
  };
};
```

If passphrase is wrong, throw `AppError("certificate.passphrase_invalid", 400, ...)`.
If parse fails for any other reason: `AppError("certificate.parse_failed", 400, ...)`.

### 6.3 Storage repository

```ts
// apps/sri-core/src/certificates/repository.ts
import { prisma } from "../db/client.js";
import { encrypt } from "./crypto.js";
import { ulid } from "ulid";

export const insertCert = async (input: {
  companyId: string;
  alias: string;
  parsed: ParsedP12;
  p12Bytes: Buffer;
  passphrase: string;
}) =>
  prisma.certificate.create({
    data: {
      id: ulid(),
      companyId: input.companyId,
      alias: input.alias,
      serialNumber: input.parsed.serialHex,
      subjectDn: input.parsed.subjectDn,
      issuerDn: input.parsed.issuerDn,
      validFrom: input.parsed.validFrom,
      validTo: input.parsed.validTo,
      status: "INACTIVE",
      encryptedP12: encrypt(input.p12Bytes),
      encryptedPass: encrypt(Buffer.from(input.passphrase, "utf8")),
      kmsKeyVersion: "v1",
    },
  });
```

### 6.4 Activation (atomic)

```ts
import { prisma } from "../db/client.js";

export const activate = async (companyId: string, certId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.certificate.updateMany({
      where: { companyId, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });
    return tx.certificate.update({
      where: { id: certId },
      data: { status: "ACTIVE" },
    });
  });
```

### 6.5 `loadActiveCertForSigning`

```ts
// apps/sri-core/src/certificates/load-for-signing.ts
import { prisma } from "../db/client.js";
import { decrypt } from "./crypto.js";
import { parseP12 } from "./parse.js";
import { AppError } from "../errors/app-error.js";

export const loadActiveCertForSigning = async (companyId: string) => {
  const cert = await prisma.certificate.findFirst({ where: { companyId, status: "ACTIVE" } });
  if (!cert) throw new AppError("certificate.not_found", 412, "No active certificate for tenant");
  if (cert.validTo.getTime() <= Date.now())
    throw new AppError("certificate.expired", 412, "Certificate expired");
  const p12 = decrypt(cert.encryptedP12);
  const pass = decrypt(cert.encryptedPass).toString("utf8");
  const parsed = parseP12(p12, pass);
  return { privateKeyPem: parsed.privateKeyPem, certPem: parsed.certPem, expiresAt: cert.validTo };
};
```

### 6.6 API surface

`apps/api/src/certificates/routes.ts`:

```
POST   /api/v1/certificates              certificate.write   multipart upload, forwards to SRI Core
GET    /api/v1/certificates              certificate.read    list metadata
GET    /api/v1/certificates/:id          certificate.read    metadata
POST   /api/v1/certificates/:id/activate certificate.write   activate atomically
DELETE /api/v1/certificates/:id          certificate.write   soft delete (sets deletedAt)
```

Multipart parsing: `multer` with `memoryStorage` and `limits: { fileSize: 200 * 1024 }`. Reject other mime types beyond `application/x-pkcs12` / `application/octet-stream`.

### 6.7 Expiry job

```ts
// apps/sri-core/src/certificates/expiry-job.ts
import cron from "node-cron";
import { prisma } from "../db/client.js";
import { audit } from "../audit/audit.js";

const DAY_MS = 86_400_000;

export const startExpiryJob = () =>
  cron.schedule("0 6 * * *", async () => {
    const certs = await prisma.certificate.findMany({ where: { status: "ACTIVE" } });
    const now = Date.now();
    for (const c of certs) {
      const days = Math.floor((c.validTo.getTime() - now) / DAY_MS);
      if (days <= 0)
        await Promise.all([
          prisma.certificate.update({ where: { id: c.id }, data: { status: "EXPIRED" } }),
          audit({
            action: "certificate.expired",
            companyId: c.companyId,
            resource: `certificate:${c.id}`,
          }),
        ]);
      else if (days <= 7)
        await audit({
          action: "certificate.expiring_soon_7",
          companyId: c.companyId,
          resource: `certificate:${c.id}`,
          metadata: { days },
        });
      else if (days <= 15)
        await audit({
          action: "certificate.expiring_soon_15",
          companyId: c.companyId,
          resource: `certificate:${c.id}`,
          metadata: { days },
        });
      else if (days <= 30)
        await audit({
          action: "certificate.expiring_soon_30",
          companyId: c.companyId,
          resource: `certificate:${c.id}`,
          metadata: { days },
        });
    }
  });
```

Leader election is deferred (only one SRI Core replica for v1). When scaling, switch to a real scheduler (pg-boss, BullMQ) or a Postgres advisory-lock pattern.

## 7. Implementation guide

### 7.1 Steps

1. Implement `apps/sri-core/src/certificates/{crypto,parse,repository,load-for-signing,expiry-job}.ts`.
2. Add `POST /v1/certificates`, `POST /v1/certificates/:id/activate`, `GET ...` handlers in SRI Core.
3. Implement `apps/api/src/certificates/{routes,handlers}` that proxy to SRI Core.
4. Add `multer`, `node-cron`, `jsonwebtoken`, `node-forge` deps.
5. Tests: parse with right pass, wrong pass; activation atomic; load-for-signing happy + expired.

### 7.2 Dependencies (apps/sri-core)

| Package      | Version  | Purpose          |
| ------------ | -------- | ---------------- |
| `node-forge` | `^1.3.1` | PKCS#12 parsing. |
| `node-cron`  | `^3.0.3` | Expiry schedule. |

### 7.3 Dependencies (apps/api)

| Package         | Version        | Purpose         |
| --------------- | -------------- | --------------- |
| `multer`        | `^1.4.5-lts.1` | Upload parsing. |
| `@types/multer` | `^1.4.12`      | Types.          |

### 7.4 Conventions

- Cert ciphertext never leaves SRI Core.
- Passphrase never appears in logs or error responses (already covered by redactions).
- Never compare passphrases by `==` — use `crypto.timingSafeEqual` only when ever needed (we don't currently; we attempt decryption and catch).

## 8. Acceptance criteria

- **AC-1.** Uploading a valid `.p12` + passphrase creates a row with status `INACTIVE`; no decrypted material on disk.
- **AC-2.** Uploading with wrong passphrase returns `400 certificate.passphrase_invalid`.
- **AC-3.** Uploading a file ≥ 200 KB returns `413`.
- **AC-4.** Activating one cert atomically deactivates the previous active for that tenant.
- **AC-5.** `loadActiveCertForSigning(companyId)` returns PEMs; throws `certificate.expired` when validTo is in the past.
- **AC-6.** Listing certs never returns `encryptedP12`, `encryptedPass`, or `privateKeyPem` in the JSON.
- **AC-7.** Expiry job, when run with a cert 5 days from expiry, writes audit `certificate.expiring_soon_7`.
- **AC-8.** Forging an `Authorization` header with mismatched tenant cannot read another tenant's cert.

## 9. Test plan

- Unit: `crypto.ts` roundtrip + tamper detection (modify a byte → decrypt throws).
- Unit: `parse.ts` with a synthetic test `.p12` fixture (generate in test, do not commit a real one).
- Integration: full upload → activate → load round-trip on a test DB.
- Negative: list cert metadata as another tenant → 404 (not 403, to avoid existence disclosure).

## 10. Security considerations

- **Master key handling:** in dev, the env var is fine. In prod, an envelope-encryption scheme with a real KMS (AWS KMS / GCP KMS / Vault) — separate ADR + spec when target host is chosen.
- **Multer in-memory:** safer than disk; the buffer lives only for the duration of the request.
- **Audit:** every upload, activation, and deletion writes `certificate.uploaded` / `certificate.activated` / `certificate.deleted`.
- **Defense in depth:** Postgres column `encryptedP12 bytea`; even if the DB dumps leak, ciphertext requires the master key.

## 11. Observability

- Metric (future): `certificate_load_ms`, `certificate_decrypt_failures_total`.
- Audit entries are the durable record of cert lifecycle.

## 12. Risks and mitigations

| Risk                            | Mitigation                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Master key leaked               | KMS in prod; quick rotation by re-encrypting all rows under a new `kmsKeyVersion`.                           |
| Wrong cert per tenant           | `loadActiveCertForSigning(companyId)` filters by `companyId`; FK contract enforced in code; no global cache. |
| Memory exposure of private keys | Keep buffers in scope as short as possible; do not assign to long-lived variables.                           |
| Operator uploads expired cert   | Validate `validTo > now` at parse time → reject.                                                             |

## 13. Open questions

- Should the API forward the file or the API never see the file at all (client uploads directly to SRI Core through a presigned upload URL)? Direct upload reduces exposure but complicates auth UX. Defer; current trust model (Web → API → SRI Core all internal) makes the forward acceptable.
- Need a "test mode" cert that signs but produces XML the SRI test environment recognises? Yes — provide a documented synthetic cert generation script under `tools/generate-test-cert.ts`.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
