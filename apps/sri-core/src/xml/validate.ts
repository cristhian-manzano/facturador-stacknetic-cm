/**
 * `validateAgainstXsd` — XSD validation wrapper around `xmllint-wasm`.
 *
 * Why `xmllint-wasm` instead of `libxmljs2`?
 *
 *   - `libxmljs2@0.33.0` ships a native add-on that requires
 *     `node-pre-gyp` compilation, which fails on Node 22 + macOS 25
 *     ("FastApiTypedArray was not declared in this scope"). Upstream
 *     activity has stalled (last release 2023).
 *   - `xmllint-wasm` bundles libxml2 as WebAssembly. Pure-JS install, no
 *     toolchain dependencies, identical XSD-validation semantics
 *     because it's the same libxml2 underneath. Spec PLAN-0023 §3
 *     explicitly authorises this fallback ("If `libxmljs2` proves
 *     troublesome in the target environment, switch to `xmllint-wasm`
 *     — the interface above is the contract regardless of
 *     implementation").
 *
 * Schema resolution:
 *   - The factura XSD imports `xmldsig-core-schema.xsd`. Both are
 *     committed under `apps/sri-core/resources/` and loaded once at
 *     module init. We pass the `<ds>` schema via `preload` so xmllint
 *     can resolve the import without a network call.
 *   - The XSD path is hard-coded to a bundled resource (security:
 *     never read a schema path from request input).
 *
 * Memoisation:
 *   - The XSD bytes are read once per process and cached on first call
 *     via `cachedSchema` below. `xmllint-wasm` re-parses the schema on
 *     every `validateXML` call — that's a libxml2 internal — but we
 *     avoid re-reading the file from disk.
 *   - The cache is lazily initialised so an `import` of this module
 *     never pays the disk-read cost; only the first
 *     `validateAgainstXsd(...)` call does. The boot-time warmer in
 *     `index.ts` exploits this so the first real request never sees
 *     the read amortised.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateXML } from "xmllint-wasm";

/** Result shape mirrors the original SPEC-0023 contract (libxmljs2 era). */
export interface XsdValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Resolve a path to a file shipped under `apps/sri-core/resources/`.
 *
 * The relative location depends on whether we're running from `src/`
 * (vitest, tsx) or from `dist/` (production). We resolve relative to
 * the current module URL and walk up to the package root.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns the absolute path to the bundled factura XSD. Exported so
 * tests can assert the runtime image actually contains the schema
 * (TASKS-0023 §5.1).
 */
export const getFacturaXsdPath = (): string => {
  // Source layout:     <pkg>/src/xml/validate.ts → <pkg>/resources/factura_V2.1.0.xsd
  // Dist layout (tsc): <pkg>/dist/xml/validate.js → <pkg>/resources/factura_V2.1.0.xsd
  // Both resolve to "..", "..", "resources" from the current file's dir.
  return path.resolve(__dirname, "..", "..", "resources", "factura_V2.1.0.xsd");
};

export const getXmldsigXsdPath = (): string => {
  return path.resolve(__dirname, "..", "..", "resources", "xmldsig-core-schema.xsd");
};

/* -------------------------------------------------------------------------- */
/*                              Schema caches                                 */
/* -------------------------------------------------------------------------- */

interface SchemaBundle {
  readonly facturaXsd: string;
  readonly xmldsigXsd: string;
}

/**
 * Lazy-initialised single-instance cache. Re-use across every
 * `validateAgainstXsd()` call so we don't re-read the 40 KiB factura
 * XSD + its xmldsig import on every invocation.
 *
 * Test note: `__resetSchemaCacheForTests()` resets this to `null` so a
 * suite that spies on `fs.readFileSync` can observe the second-call-no-
 * read assertion.
 */
let cachedSchema: SchemaBundle | null = null;

const loadSchemas = (): SchemaBundle => {
  if (cachedSchema !== null) return cachedSchema;
  // We deliberately call into `fs` via the named import object so a
  // vitest spy (`vi.spyOn(fs, 'readFileSync')`) can intercept and
  // count the call.
  const facturaXsd = fs.readFileSync(getFacturaXsdPath(), "utf8");
  const xmldsigXsd = fs.readFileSync(getXmldsigXsdPath(), "utf8");
  cachedSchema = { facturaXsd, xmldsigXsd };
  return cachedSchema;
};

/* -------------------------------------------------------------------------- */
/*                                Validator                                   */
/* -------------------------------------------------------------------------- */

/**
 * Validate `xml` against the bundled factura XSD V2.1.0.
 *
 * Returns `{ valid: true }` on success, `{ valid: false, errors }` on
 * failure. The error strings are taken verbatim from xmllint and may
 * include line numbers from the in-memory file. We don't try to PII-mask
 * them here because the only caller is the orchestrator, which already
 * logs through the redacted logger (security.md §3, REDACT_PATHS).
 */
export const validateAgainstXsd = async (xml: string): Promise<XsdValidationResult> => {
  const { facturaXsd, xmldsigXsd } = loadSchemas();
  const result = await validateXML({
    xml: [{ fileName: "factura.xml", contents: xml }],
    schema: [{ fileName: "factura_V2.1.0.xsd", contents: facturaXsd }],
    preload: [{ fileName: "xmldsig-core-schema.xsd", contents: xmldsigXsd }],
  });
  if (result.valid) return { valid: true, errors: [] };
  return {
    valid: false,
    // `message` is typed as `string` in xmllint-wasm's d.ts so we don't
    // need a fallback to `rawMessage`. Surfacing the parsed message keeps
    // the output compact for downstream logs.
    errors: result.errors.map((e) => e.message),
  };
};

/**
 * Reset the memoised schema cache. Test-only — never call from
 * production code. The intent is to let a unit test reload schemas
 * after monkey-patching the resource path; we don't need it for the
 * happy path but it keeps the cache honest in fuzz-style suites.
 */
export const __resetSchemaCacheForTests = (): void => {
  cachedSchema = null;
};
