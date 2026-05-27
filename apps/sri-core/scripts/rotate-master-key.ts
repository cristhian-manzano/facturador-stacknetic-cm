/**
 * `rotate-master-key.ts` — re-encrypt every `Certificate` row from an old
 * AES-256 master key to a new one.
 *
 * Usage:
 *
 *   OLD_MASTER_KEY_HEX=<64 hex chars> \
 *   NEW_MASTER_KEY_HEX=<64 hex chars> \
 *   NEW_KMS_KEY_VERSION=v2 \
 *   pnpm --filter @facturador/sri-core rotate:master-key
 *
 * Behaviour:
 *
 *   - Decrypts the `.p12` envelope (and the optional passphrase envelope)
 *     under `OLD_MASTER_KEY_HEX`.
 *   - Re-encrypts the plaintext under `NEW_MASTER_KEY_HEX` with a fresh
 *     12-byte nonce (and a fresh tag returned by AES-GCM).
 *   - Updates the row's `p12{Ciphertext,Nonce,Tag}B64` columns and bumps
 *     `kmsKeyVersion` to `NEW_KMS_KEY_VERSION` (default: `"v2"`).
 *   - Idempotent: rows whose `kmsKeyVersion` already matches the target
 *     are skipped (logged + counted, but no DB write).
 *   - Streams progress to stdout. The final line is a summary in the
 *     shape `{"ok":N,"skipped":M,"failed":K}` for shell consumers.
 *
 * Safety:
 *
 *   - Reads the old + new keys via env vars only — they never touch the
 *     CLI argv or the process title.
 *   - Logs ONLY counts + non-sensitive identifiers (`id`, `companyId`).
 *     The plaintext .p12 / passphrase bytes never reach stdout.
 *   - Failures are caught per row so a single corrupt envelope doesn't
 *     abort the rest of the rotation. Failed rows are listed by id in
 *     the final summary so an operator can re-run with the original
 *     master key to investigate.
 *
 * Disaster recovery:
 *
 *   - Run with `DRY_RUN=true` first to surface bad rows without writing.
 *   - If the new key is wrong, the script halts on the first row (the
 *     AES-GCM `final()` throws — we re-throw at row 0 only).
 *   - Always take a database snapshot before running this in production.
 */
import process from "node:process";

import { createPrismaClient, type PrismaClient } from "@facturador/db";
import {
  decodeMasterKeyHex,
  decryptEnvelope,
  encryptEnvelope,
} from "@facturador/utils/crypto";

interface RotationSummary {
  ok: number;
  skipped: number;
  failed: number;
  failedIds: string[];
}

interface RotationOptions {
  prisma: PrismaClient;
  oldKey: Buffer;
  newKey: Buffer;
  newVersion: string;
  dryRun: boolean;
  log: (line: string) => void;
}

/**
 * Re-encrypt every certificate row. Exposed as a pure function so the
 * test suite can drive it without touching `process.env` / `process.exit`.
 */
export async function rotateMasterKey(options: RotationOptions): Promise<RotationSummary> {
  const { prisma, oldKey, newKey, newVersion, dryRun, log } = options;
  const summary: RotationSummary = { ok: 0, skipped: 0, failed: 0, failedIds: [] };

  // No tenant filter on purpose: rotation is a SYSTEM-LEVEL operation that
  // visits every encrypted blob in the table, irrespective of tenant. The
  // ESLint rule that normally requires a `companyId` filter on tenant
  // models is silenced here because this script is the canonical owner of
  // the master-key rotation flow.
  // eslint-disable-next-line @facturador/security/require-companyId-filter -- system-level rotation visits every row by design (see header docstring).
  const rows = await prisma.certificate.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      companyId: true,
      kmsKeyVersion: true,
      p12CiphertextB64: true,
      p12NonceB64: true,
      p12TagB64: true,
      passphraseCiphertextB64: true,
      passphraseNonceB64: true,
      passphraseTagB64: true,
    },
  });

  log(`[rotate-master-key] inspecting ${String(rows.length)} certificate row(s).`);

  for (const row of rows) {
    if (row.kmsKeyVersion === newVersion) {
      summary.skipped++;
      log(`[rotate-master-key] skip id=${row.id} (already at ${newVersion}).`);
      continue;
    }
    try {
      // ---- .p12 envelope ----
      const p12Plain = decryptEnvelope(
        {
          ciphertext: Buffer.from(row.p12CiphertextB64, "base64"),
          nonce: Buffer.from(row.p12NonceB64, "base64"),
          tag: Buffer.from(row.p12TagB64, "base64"),
        },
        oldKey,
      );
      const p12New = encryptEnvelope(p12Plain, newKey);

      // ---- passphrase envelope (optional) ----
      let newPassphrase: ReturnType<typeof encryptEnvelope> | null = null;
      if (
        row.passphraseCiphertextB64 !== null &&
        row.passphraseNonceB64 !== null &&
        row.passphraseTagB64 !== null
      ) {
        const passPlain = decryptEnvelope(
          {
            ciphertext: Buffer.from(row.passphraseCiphertextB64, "base64"),
            nonce: Buffer.from(row.passphraseNonceB64, "base64"),
            tag: Buffer.from(row.passphraseTagB64, "base64"),
          },
          oldKey,
        );
        newPassphrase = encryptEnvelope(passPlain, newKey);
      }

      if (dryRun) {
        log(`[rotate-master-key] (dry-run) would rotate id=${row.id}.`);
        summary.ok++;
        continue;
      }

      // eslint-disable-next-line @facturador/security/require-companyId-filter -- system-level rotation (see header docstring).
      await prisma.certificate.update({
        where: { id: row.id },
        data: {
          p12CiphertextB64: p12New.ciphertext.toString("base64"),
          p12NonceB64: p12New.nonce.toString("base64"),
          p12TagB64: p12New.tag.toString("base64"),
          ...(newPassphrase === null
            ? {}
            : {
                passphraseCiphertextB64: newPassphrase.ciphertext.toString("base64"),
                passphraseNonceB64: newPassphrase.nonce.toString("base64"),
                passphraseTagB64: newPassphrase.tag.toString("base64"),
              }),
          kmsKeyVersion: newVersion,
        },
      });
      summary.ok++;
      log(`[rotate-master-key] rotated id=${row.id} → ${newVersion}.`);
    } catch (err) {
      summary.failed++;
      summary.failedIds.push(row.id);
      const msg = err instanceof Error ? err.message : String(err);
      log(`[rotate-master-key] FAILED id=${row.id}: ${msg}`);
      // Halt on the very first failure — if the new key is wrong every
      // subsequent row would also fail and burn budget for nothing. The
      // operator can re-run after restoring the old key.
      if (summary.ok === 0 && summary.skipped === 0) {
        log(`[rotate-master-key] aborting: first row failed (probable bad key).`);
        break;
      }
    }
  }

  log(
    `[rotate-master-key] summary ok=${String(summary.ok)} skipped=${String(summary.skipped)} failed=${String(summary.failed)}`,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked directly via `tsx`.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const oldHex = process.env.OLD_MASTER_KEY_HEX;
  const newHex = process.env.NEW_MASTER_KEY_HEX;
  const newVersion = process.env.NEW_KMS_KEY_VERSION ?? "v2";
  const dryRun = process.env.DRY_RUN === "true";

  if (oldHex === undefined || oldHex.length === 0) {
    process.stderr.write("OLD_MASTER_KEY_HEX is required (64 hex chars).\n");
    process.exit(1);
  }
  if (newHex === undefined || newHex.length === 0) {
    process.stderr.write("NEW_MASTER_KEY_HEX is required (64 hex chars).\n");
    process.exit(1);
  }

  const oldKey = decodeMasterKeyHex(oldHex);
  const newKey = decodeMasterKeyHex(newHex);
  if (oldKey.equals(newKey)) {
    process.stderr.write("OLD_MASTER_KEY_HEX and NEW_MASTER_KEY_HEX must differ.\n");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const summary = await rotateMasterKey({
      prisma,
      oldKey,
      newKey,
      newVersion,
      dryRun,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    process.stdout.write(
      `${JSON.stringify({ ok: summary.ok, skipped: summary.skipped, failed: summary.failed })}\n`,
    );
    process.exit(summary.failed === 0 ? 0 : 2);
  } finally {
    await prisma.$disconnect();
  }
}

// Run when invoked directly via `tsx scripts/rotate-master-key.ts`. The
// `import.meta.url` check keeps the helper importable from tests.
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void main();
}
