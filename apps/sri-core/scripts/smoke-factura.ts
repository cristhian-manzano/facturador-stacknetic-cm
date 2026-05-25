/**
 * Smoke runner for the factura XML builder (PROMPT-0023 finishing-line
 * checks: "A smoke node script builds a factura and prints to stdout;
 * manual inspection shows well-formed XML").
 *
 * Reads the seed-aligned golden fixture and writes the resulting XML
 * to stdout, then runs XSD validation and prints the result on stderr
 * (so stdout stays pure XML for piping to `xmllint --format`).
 *
 * Usage:
 *   pnpm --filter @facturador/sri-core exec tsx scripts/smoke-factura.ts
 *
 * The script is intentionally simple — no flags, no env knobs — because
 * it's a one-off developer aid, not a production entry point.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFacturaXml } from "../src/xml/factura.js";
import { validateAgainstXsd } from "../src/xml/validate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const inputPath = path.resolve(
    __dirname,
    "..",
    "test",
    "fixtures",
    "factura",
    "golden-01.input.json",
  );
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as unknown;
  const { xml, xmlForSigning } = buildFacturaXml(input);
  process.stdout.write(xml + "\n");
  const result = await validateAgainstXsd(xmlForSigning);
  process.stderr.write(`XSD valid: ${result.valid ? "yes" : "no"}\n`);
  if (!result.valid) {
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[smoke-factura] failed: ${message}\n`);
  process.exit(1);
});
