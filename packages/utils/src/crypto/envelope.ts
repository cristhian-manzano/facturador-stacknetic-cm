/**
 * AES-256-GCM envelope helper — encrypt/decrypt buffers under a 32-byte
 * master key, returning a tuple of `(ciphertext, nonce, tag)` so callers
 * can persist the three pieces alongside the row.
 *
 * Source of truth:
 *   - SPEC-0021 §6.1 (algorithm, key + nonce sizes, layout).
 *   - PLAN-0021 §3 (AES-256-GCM, 12-byte nonce, KMS-deferred).
 *   - TASKS-0021 §1.1 (encrypt/decrypt round-trip, tamper test).
 *   - ai/context/security.md (crown jewels — never log key/nonce/tag in clear).
 *
 * Cipher parameters (locked):
 *   - Algorithm: AES-256-GCM (NIST-approved AEAD).
 *   - Key length: 256 bits (32 bytes), validated at every call.
 *   - Nonce length: 96 bits (12 bytes), generated via `crypto.randomBytes`
 *     for every encryption. GCM nonce uniqueness per (key, nonce) tuple is
 *     mandatory; we never accept caller-provided nonces.
 *   - Auth tag length: 128 bits (16 bytes), the GCM default. Tag is stored
 *     beside the ciphertext; tampering with any of the three breaks the
 *     `decipher.final()` integrity check.
 *
 * Layout policy:
 *   - The helper returns and accepts `Buffer` values. Persistence callers
 *     base64-encode the three buffers at the column boundary and decode
 *     here before passing them in.
 *   - Two separate envelopes are used for the .p12 bytes and the
 *     passphrase (SPEC-0021 §6.1), each with its own freshly randomised
 *     nonce. Re-using a nonce between them under the same master key is a
 *     security defect.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Master-key size in bytes (256 bits). Exported so call sites that validate
 * env vars can reference the same constant.
 */
export const MASTER_KEY_BYTES = 32;

/**
 * GCM nonce size in bytes (96 bits). The widely-recommended default for
 * AES-GCM; deviating from 12 is a runtime mistake — verify in tests.
 */
export const GCM_NONCE_BYTES = 12;

/**
 * GCM auth tag size in bytes (128 bits). The default returned by Node's
 * `cipher.getAuthTag()`. Lock the value so a future refactor can't silently
 * change envelope verification semantics.
 */
export const GCM_TAG_BYTES = 16;

/**
 * Cipher identifier as understood by `node:crypto`.
 */
export const CIPHER_ALGORITHM = "aes-256-gcm";

/**
 * Shape returned by `encryptEnvelope`. The three buffers are independent —
 * persistence stores them in distinct columns (b64-encoded).
 */
export interface EncryptedEnvelope {
  /** Raw ciphertext bytes (length === plaintext length, AEAD streaming). */
  readonly ciphertext: Buffer;
  /** 12-byte random nonce. */
  readonly nonce: Buffer;
  /** 16-byte GCM auth tag. */
  readonly tag: Buffer;
}

/**
 * Validates `key` to be exactly `MASTER_KEY_BYTES` long. Throws an `Error`
 * whose message names the constant — we deliberately do NOT print the key
 * value or length in any error returned to a caller (we throw fast and let
 * the upstream redaction-aware logger handle structured logging).
 */
function assertMasterKey(key: Buffer): void {
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `crypto.envelope: master key must be ${String(MASTER_KEY_BYTES)} bytes (got ${String(key.length)}).`,
    );
  }
}

/**
 * Encrypt `plaintext` under `masterKey` with AES-256-GCM. Returns the
 * ciphertext, the freshly generated nonce, and the auth tag as three
 * independent buffers.
 *
 * Throws if `masterKey` is the wrong length.
 */
export function encryptEnvelope(plaintext: Buffer, masterKey: Buffer): EncryptedEnvelope {
  assertMasterKey(masterKey);
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, nonce, tag };
}

/**
 * Decrypt an envelope. Returns the plaintext buffer.
 *
 * Throws if:
 *   - `masterKey` is the wrong length,
 *   - `nonce` is not 12 bytes,
 *   - `tag` is not 16 bytes, or
 *   - the GCM auth check fails (wrong key, tampered ciphertext, tampered
 *     tag, tampered nonce, … all produce the same opaque failure).
 *
 * We intentionally let `decipher.final()` throw the underlying
 * "Unsupported state or unable to authenticate data" error rather than
 * wrapping it — callers in apps/sri-core map this to a typed
 * `BadEnvelopeError` at the route boundary.
 */
export function decryptEnvelope(envelope: EncryptedEnvelope, masterKey: Buffer): Buffer {
  assertMasterKey(masterKey);
  if (envelope.nonce.length !== GCM_NONCE_BYTES) {
    throw new Error(
      `crypto.envelope: nonce must be ${String(GCM_NONCE_BYTES)} bytes (got ${String(envelope.nonce.length)}).`,
    );
  }
  if (envelope.tag.length !== GCM_TAG_BYTES) {
    throw new Error(
      `crypto.envelope: tag must be ${String(GCM_TAG_BYTES)} bytes (got ${String(envelope.tag.length)}).`,
    );
  }
  const decipher = createDecipheriv(CIPHER_ALGORITHM, masterKey, envelope.nonce);
  decipher.setAuthTag(envelope.tag);
  return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
}

/**
 * Validate that a hex string is exactly `MASTER_KEY_BYTES * 2` characters
 * long and parses as hex. Returns the decoded `Buffer`. Throws otherwise.
 *
 * Call this at boot from `env.ts` so the service refuses to start with a
 * misconfigured master key. The error message names the failure mode but
 * never includes the actual value.
 */
export function decodeMasterKeyHex(value: string): Buffer {
  if (!/^[0-9a-fA-F]+$/u.test(value)) {
    throw new Error("crypto.envelope: master key must be a hex string (0-9, a-f).");
  }
  if (value.length !== MASTER_KEY_BYTES * 2) {
    throw new Error(
      `crypto.envelope: master key must be ${String(MASTER_KEY_BYTES * 2)} hex characters (got ${String(value.length)}).`,
    );
  }
  return Buffer.from(value, "hex");
}
