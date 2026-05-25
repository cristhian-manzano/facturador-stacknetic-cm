/**
 * Unit tests for the AES-256-GCM envelope helper.
 *
 * Coverage targets:
 *   - encrypt → decrypt is byte-identical for random payloads,
 *   - tampering the ciphertext / nonce / tag breaks decryption (fail closed),
 *   - the wrong master key fails decryption,
 *   - every encryption draws a fresh nonce,
 *   - master-key length validation (32 bytes hex / 64 hex chars).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CIPHER_ALGORITHM,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  MASTER_KEY_BYTES,
  decodeMasterKeyHex,
  decryptEnvelope,
  encryptEnvelope,
} from "./envelope.js";

const KEY = Buffer.alloc(MASTER_KEY_BYTES, 0x42);

describe("envelope.encrypt/decrypt", () => {
  it("publishes locked cipher parameters", () => {
    expect(CIPHER_ALGORITHM).toBe("aes-256-gcm");
    expect(MASTER_KEY_BYTES).toBe(32);
    expect(GCM_NONCE_BYTES).toBe(12);
    expect(GCM_TAG_BYTES).toBe(16);
  });

  it("round-trips a 1 KB random buffer byte-for-byte", () => {
    const plaintext = randomBytes(1024);
    const env = encryptEnvelope(plaintext, KEY);
    expect(env.nonce.length).toBe(GCM_NONCE_BYTES);
    expect(env.tag.length).toBe(GCM_TAG_BYTES);
    const recovered = decryptEnvelope(env, KEY);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it("generates a fresh nonce per call", () => {
    const plaintext = Buffer.from("constant payload");
    const env1 = encryptEnvelope(plaintext, KEY);
    const env2 = encryptEnvelope(plaintext, KEY);
    expect(env1.nonce.equals(env2.nonce)).toBe(false);
    expect(env1.ciphertext.equals(env2.ciphertext)).toBe(false);
  });

  it("fails decryption when the tag is tampered", () => {
    const env = encryptEnvelope(Buffer.from("secret bytes"), KEY);
    const badTag = Buffer.from(env.tag);
    badTag[0] = badTag[0]! ^ 0xff;
    expect(() => decryptEnvelope({ ...env, tag: badTag }, KEY)).toThrow();
  });

  it("fails decryption when the ciphertext is tampered", () => {
    const env = encryptEnvelope(Buffer.from("secret bytes"), KEY);
    const badCt = Buffer.from(env.ciphertext);
    badCt[0] = badCt[0]! ^ 0x01;
    expect(() => decryptEnvelope({ ...env, ciphertext: badCt }, KEY)).toThrow();
  });

  it("fails decryption when the nonce is tampered", () => {
    const env = encryptEnvelope(Buffer.from("secret bytes"), KEY);
    const badNonce = Buffer.from(env.nonce);
    badNonce[0] = badNonce[0]! ^ 0x01;
    expect(() => decryptEnvelope({ ...env, nonce: badNonce }, KEY)).toThrow();
  });

  it("fails decryption with a wrong master key (closed against key-substitution)", () => {
    const env = encryptEnvelope(Buffer.from("secret bytes"), KEY);
    const wrongKey = Buffer.alloc(MASTER_KEY_BYTES, 0x43);
    expect(() => decryptEnvelope(env, wrongKey)).toThrow();
  });

  it("rejects a master key that is too short", () => {
    const shortKey = Buffer.alloc(16, 0x42);
    expect(() => encryptEnvelope(Buffer.from("x"), shortKey)).toThrow(/master key/i);
  });

  it("rejects a nonce of the wrong length on decrypt", () => {
    const env = encryptEnvelope(Buffer.from("x"), KEY);
    expect(() => decryptEnvelope({ ...env, nonce: Buffer.alloc(8) }, KEY)).toThrow(/nonce/i);
  });

  it("rejects a tag of the wrong length on decrypt", () => {
    const env = encryptEnvelope(Buffer.from("x"), KEY);
    expect(() => decryptEnvelope({ ...env, tag: Buffer.alloc(8) }, KEY)).toThrow(/tag/i);
  });
});

describe("decodeMasterKeyHex", () => {
  it("decodes a valid 64-char hex string into 32 bytes", () => {
    const hex = "00".repeat(32);
    const decoded = decodeMasterKeyHex(hex);
    expect(decoded.length).toBe(32);
  });

  it("rejects a non-hex string", () => {
    expect(() => decodeMasterKeyHex("Z".repeat(64))).toThrow(/hex/i);
  });

  it("rejects a hex string that is not 64 chars long", () => {
    expect(() => decodeMasterKeyHex("00".repeat(16))).toThrow(/64 hex/i);
  });
});
