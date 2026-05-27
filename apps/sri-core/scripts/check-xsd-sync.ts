/**
 * CI guard — byte-equality check between the two factura XSD copies.
 *
 * Source of truth:
 *   - audit-punchlist Item 8 (REVIEW-0023 §12 #5).
 *
 * The canonical XSD ships in two locations:
 *   - `docs/sri/factura/factura_V2.1.0.xsd` (documentation source-of-truth).
 *   - `apps/sri-core/resources/factura_V2.1.0.xsd` (runtime copy).
 *
 * When SRI publishes a new XSD revision we update BOTH files. This
 * script verifies they stay byte-equal; mismatch exits non-zero so the
 * CI step fails loudly and the operator must reconcile.
 *
 * Exit codes:
 *   - 0 → bytes match.
 *   - 1 → mismatch (prints sha256 of each + length diff).
 *   - 2 → either file is missing.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const DOCS_XSD = resolve(ROOT, "docs", "sri", "factura", "factura_V2.1.0.xsd");
const RUNTIME_XSD = resolve(ROOT, "apps", "sri-core", "resources", "factura_V2.1.0.xsd");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function main(): void {
  if (!existsSync(DOCS_XSD)) {
    process.stderr.write(`[check-xsd-sync] missing docs XSD: ${DOCS_XSD}\n`);
    process.exit(2);
  }
  if (!existsSync(RUNTIME_XSD)) {
    process.stderr.write(`[check-xsd-sync] missing runtime XSD: ${RUNTIME_XSD}\n`);
    process.exit(2);
  }
  const a = readFileSync(DOCS_XSD);
  const b = readFileSync(RUNTIME_XSD);
  if (a.equals(b)) {
    process.stdout.write(
      `[check-xsd-sync] OK (sha256=${sha256(a)}, ${String(a.byteLength)} bytes)\n`,
    );
    return;
  }
  process.stderr.write(
    `[check-xsd-sync] MISMATCH between docs/ and apps/sri-core/resources/.\n` +
      `  docs/    : sha256=${sha256(a)} bytes=${String(a.byteLength)}\n` +
      `  runtime/ : sha256=${sha256(b)} bytes=${String(b.byteLength)}\n` +
      `  Resync by copying the docs/ file into apps/sri-core/resources/ (or vice-versa).\n`,
  );
  process.exit(1);
}

main();
