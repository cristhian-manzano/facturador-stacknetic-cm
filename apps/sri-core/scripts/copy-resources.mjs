/**
 * Post-build helper: copy `resources/` into `dist/resources/` so the
 * shipped `dist/xml/validate.js` can resolve the bundled XSDs at runtime.
 *
 * Source of truth: TASKS-0023 §5.1 ("the built image contains
 * /app/apps/sri-core/dist/resources/factura_V2.1.0.xsd").
 *
 * We use `.mjs` directly (no transpile) so this script can run in the
 * Docker build stage without depending on `tsx`. Idempotent: re-running
 * after no changes only updates file metadata.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "..");
const srcDir = path.join(pkgRoot, "resources");
const dstDir = path.join(pkgRoot, "dist", "resources");

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

try {
  copyDir(srcDir, dstDir);
  process.stdout.write(`[copy-resources] copied ${srcDir} → ${dstDir}\n`);
} catch (err) {
  process.stderr.write(
    `[copy-resources] failed: ${err && err.message ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
