/**
 * Tests for the `rotate-master-key` script. We exercise the pure
 * `rotateMasterKey` helper (which the CLI entry wraps) against an
 * in-memory mock of the subset of Prisma we use. This avoids the script
 * having to talk to a real Postgres instance — the envelope crypto is
 * fully covered in `packages/utils/src/crypto/envelope.test.ts`.
 *
 * Coverage:
 *
 *   - Round-trip: a row encrypted with KEY_A decrypts cleanly under
 *     KEY_B after the script writes the new envelope back.
 *   - Idempotency: a second invocation with `newVersion === current` is
 *     a no-op (the row is counted as `skipped`).
 *   - Passphrase envelope is rotated too when present.
 *   - The rotation is a no-op when there are no rows.
 *   - Bad-key abort: the first row failing aborts the remainder.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeMasterKeyHex, decryptEnvelope, encryptEnvelope } from "@facturador/utils/crypto";

import { rotateMasterKey } from "./rotate-master-key.js";

// A 64-hex-char string for testing.
const KEY_A_HEX = "00".repeat(32);
const KEY_B_HEX = "11".repeat(32);

interface FakeRow {
  id: string;
  companyId: string;
  kmsKeyVersion: string;
  p12CiphertextB64: string;
  p12NonceB64: string;
  p12TagB64: string;
  passphraseCiphertextB64: string | null;
  passphraseNonceB64: string | null;
  passphraseTagB64: string | null;
}

function makeFakePrisma(rows: FakeRow[]) {
  return {
    certificate: {
      findMany: () => Promise.resolve(rows),
      update: ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error(`no row ${where.id}`);
        const current = rows[idx]!;
        rows[idx] = { ...current, ...data };
        return Promise.resolve(rows[idx]);
      },
    },
  };
}

function buildRow(id: string, plaintext: Buffer, key: Buffer, withPassphrase: boolean): FakeRow {
  const env = encryptEnvelope(plaintext, key);
  const pass = withPassphrase ? encryptEnvelope(Buffer.from("p4ssphr4se"), key) : null;
  return {
    id,
    companyId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    kmsKeyVersion: "v1",
    p12CiphertextB64: env.ciphertext.toString("base64"),
    p12NonceB64: env.nonce.toString("base64"),
    p12TagB64: env.tag.toString("base64"),
    passphraseCiphertextB64: pass === null ? null : pass.ciphertext.toString("base64"),
    passphraseNonceB64: pass === null ? null : pass.nonce.toString("base64"),
    passphraseTagB64: pass === null ? null : pass.tag.toString("base64"),
  };
}

describe("rotate-master-key", () => {
  it("re-encrypts every row from KEY_A to KEY_B and decryption works with KEY_B", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    const p12Plain = randomBytes(512);
    const rows: FakeRow[] = [
      buildRow("01", p12Plain, keyA, true),
      buildRow("02", randomBytes(64), keyA, false),
    ];

    const summary = await rotateMasterKey({
      prisma: makeFakePrisma(rows) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: false,
      log: () => {},
    });

    expect(summary.ok).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(rows[0]!.kmsKeyVersion).toBe("v2");

    // Round-trip with the new key recovers the original plaintext.
    const recovered = decryptEnvelope(
      {
        ciphertext: Buffer.from(rows[0]!.p12CiphertextB64, "base64"),
        nonce: Buffer.from(rows[0]!.p12NonceB64, "base64"),
        tag: Buffer.from(rows[0]!.p12TagB64, "base64"),
      },
      keyB,
    );
    expect(recovered.equals(p12Plain)).toBe(true);
  });

  it("is idempotent — running again when the row already has the new version is a skip", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    const rows: FakeRow[] = [buildRow("01", randomBytes(32), keyA, false)];
    rows[0]!.kmsKeyVersion = "v2"; // simulate already-rotated.

    const summary = await rotateMasterKey({
      prisma: makeFakePrisma(rows) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: false,
      log: () => {},
    });

    expect(summary.ok).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("rotates the passphrase envelope when present", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    const rows: FakeRow[] = [buildRow("01", randomBytes(32), keyA, true)];
    const passPlainBefore = decryptEnvelope(
      {
        ciphertext: Buffer.from(rows[0]!.passphraseCiphertextB64!, "base64"),
        nonce: Buffer.from(rows[0]!.passphraseNonceB64!, "base64"),
        tag: Buffer.from(rows[0]!.passphraseTagB64!, "base64"),
      },
      keyA,
    );

    await rotateMasterKey({
      prisma: makeFakePrisma(rows) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: false,
      log: () => {},
    });

    const passPlainAfter = decryptEnvelope(
      {
        ciphertext: Buffer.from(rows[0]!.passphraseCiphertextB64!, "base64"),
        nonce: Buffer.from(rows[0]!.passphraseNonceB64!, "base64"),
        tag: Buffer.from(rows[0]!.passphraseTagB64!, "base64"),
      },
      keyB,
    );
    expect(passPlainAfter.equals(passPlainBefore)).toBe(true);
  });

  it("dry-run does not mutate the rows", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    const rows: FakeRow[] = [buildRow("01", randomBytes(32), keyA, false)];
    const before = JSON.stringify(rows);

    const summary = await rotateMasterKey({
      prisma: makeFakePrisma(rows) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: true,
      log: () => {},
    });

    expect(summary.ok).toBe(1);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("no-op when there are no rows", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    const summary = await rotateMasterKey({
      prisma: makeFakePrisma([]) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: false,
      log: () => {},
    });
    expect(summary).toEqual({ ok: 0, skipped: 0, failed: 0, failedIds: [] });
  });

  it("aborts the whole run when the very first row fails (probable wrong key)", async () => {
    const keyA = decodeMasterKeyHex(KEY_A_HEX);
    const keyB = decodeMasterKeyHex(KEY_B_HEX);
    // Encrypt under KEY_B but tell the script the OLD key is KEY_A — every
    // row will fail to decrypt. We expect the loop to halt after the first.
    const rows: FakeRow[] = [
      buildRow("01", randomBytes(32), keyB, false),
      buildRow("02", randomBytes(32), keyB, false),
    ];

    const summary = await rotateMasterKey({
      prisma: makeFakePrisma(rows) as unknown as Parameters<typeof rotateMasterKey>[0]["prisma"],
      oldKey: keyA,
      newKey: keyB,
      newVersion: "v2",
      dryRun: false,
      log: () => {},
    });

    expect(summary.ok).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.failedIds).toEqual(["01"]);
  });
});
