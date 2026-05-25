/**
 * Copy the canonical SRI XSDs from `docs/sri/` into the runtime
 * `apps/sri-core/resources/` directory and verify they match.
 *
 * Why: PLAN-0023 §7.1 + TASKS-0023 §5.1 — the validator (`xml/validate.ts`)
 * resolves the XSD from a bundled resource path, so the build must
 * mirror the canonical schema. A divergence between `docs/sri/` and
 * `resources/` would silently accept invalid XML.
 *
 * Behaviour:
 *   1. Read `docs/sri/factura/factura_V2.1.0.xsd`.
 *   2. Write to `apps/sri-core/resources/factura_V2.1.0.xsd` only if the
 *      content differs (or the file is missing). This keeps the
 *      file timestamps stable so Vite / Docker caches aren't busted.
 *   3. Exit non-zero if the source XSD is missing — i.e. a CI sanity
 *      check that the canonical schema hasn't been removed.
 *
 * The `xmldsig-core-schema.xsd` is committed alongside `factura_V2.1.0.xsd`
 * in `resources/` (it is sourced from the public W3C spec; not part of
 * `docs/sri/`). This script only validates the SRI-issued XSD copy.
 *
 * Usage: `tsx apps/sri-core/scripts/copy-schemas.ts`
 * Hooked into `apps/sri-core/package.json` as `prebuild` and `predev`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const SOURCE = path.join(repoRoot, "docs", "sri", "factura", "factura_V2.1.0.xsd");
const TARGET = path.join(repoRoot, "apps", "sri-core", "resources", "factura_V2.1.0.xsd");

function main(): void {
  if (!existsSync(SOURCE)) {
    process.stderr.write(`[copy-schemas] missing source XSD at ${SOURCE}. Aborting.\n`);
    process.exit(1);
  }
  const src = readFileSync(SOURCE);
  if (existsSync(TARGET)) {
    const cur = readFileSync(TARGET);
    if (Buffer.compare(src, cur) === 0) {
      // No-op: bytes already match. Don't touch the timestamp.
      return;
    }
  }
  writeFileSync(TARGET, src);
  process.stdout.write(`[copy-schemas] refreshed ${TARGET}\n`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[copy-schemas] failed: ${message}\n`);
  process.exit(1);
}
