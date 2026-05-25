/**
 * sri-core's binding between the env-derived master key and the shared
 * envelope primitives in `@facturador/utils/crypto`.
 *
 * Why a wrapper:
 *   - The shared helper is key-agnostic on purpose — tests inject a
 *     constant key; production wires the env value.
 *   - This module is the only place inside apps/sri-core that turns the
 *     hex string into a `Buffer`. Everything downstream uses
 *     `encryptP12` / `decryptP12` and never touches the raw key.
 *
 * Source of truth: SPEC-0021 §6.1 + TASKS-0021 §1.1.
 */
import {
  decodeMasterKeyHex,
  decryptEnvelope,
  encryptEnvelope,
  type EncryptedEnvelope,
} from "@facturador/utils/crypto";
import { env as defaultEnv } from "../env.js";

let cachedKey: Buffer | undefined;

function masterKey(): Buffer {
  if (cachedKey !== undefined) return cachedKey;
  // In SRI_STUB_MODE the env layer accepts a non-hex placeholder so the
  // dev `.env.example` can boot the service. The crypto path itself is
  // never exercised in stub mode — but if a caller does hit it, fall back
  // to a deterministic dev-only zero key so the failure mode is loud
  // (every decrypt-fail closed-fails identically) rather than a confusing
  // hex-parse exception leaking into a log line.
  let key: Buffer;
  try {
    key = decodeMasterKeyHex(defaultEnv.SRI_CERT_MASTER_KEY_HEX);
  } catch {
    if (defaultEnv.SRI_STUB_MODE) {
      key = Buffer.alloc(32, 0);
    } else {
      throw new Error(
        "sri-core/crypto: SRI_CERT_MASTER_KEY_HEX is not a valid 64-char hex string.",
      );
    }
  }
  cachedKey = key;
  return key;
}

/**
 * Reset the cached master key. Tests only — flips the module state so
 * `env.ts` overrides via re-import work across describe blocks.
 */
export function __resetMasterKeyCache(): void {
  cachedKey = undefined;
}

/**
 * Encrypt a plaintext buffer (.p12 bytes or a UTF-8 passphrase) under the
 * sri-core master key. The returned envelope has distinct buffers for
 * ciphertext, nonce, and tag — callers store all three.
 */
export function encryptP12(plaintext: Buffer): EncryptedEnvelope {
  return encryptEnvelope(plaintext, masterKey());
}

/**
 * Decrypt an envelope produced by `encryptP12`. Throws an opaque GCM
 * authentication error on any tampering or key mismatch. Route handlers
 * map this to a typed `BadEnvelopeError`.
 */
export function decryptP12(envelope: EncryptedEnvelope): Buffer {
  return decryptEnvelope(envelope, masterKey());
}

export type { EncryptedEnvelope } from "@facturador/utils/crypto";
