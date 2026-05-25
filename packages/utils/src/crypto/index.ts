/**
 * Public surface for the crypto subpath. Only the envelope primitives are
 * exported; everything else (key derivation, KMS adapters) is deferred to
 * later specs.
 */
export {
  CIPHER_ALGORITHM,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  MASTER_KEY_BYTES,
  decodeMasterKeyHex,
  decryptEnvelope,
  encryptEnvelope,
  type EncryptedEnvelope,
} from "./envelope.js";
