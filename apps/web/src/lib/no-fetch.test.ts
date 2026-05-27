/**
 * Architecture invariant: only `lib/api.ts` is allowed to call `fetch`
 * directly. Every other source file under `src/` must go through
 * `apiFetch` (SPEC-0040 §6.2, TASKS-0040 hard rules).
 *
 * This test greps the compiled source tree and fails fast if a regression
 * sneaks in (e.g. a developer copy-pastes a `fetch("/api/...")` into a
 * route component during a refactor).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, "..");
const ALLOWED_FETCH_FILE = "src/lib/api.ts";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      yield* walk(abs);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield abs;
    }
  }
}

describe("architectural invariant: no direct fetch()", () => {
  it("only src/lib/api.ts may contain a direct `fetch(` call", () => {
    const offenders: string[] = [];
    for (const abs of walk(SRC_DIR)) {
      // Skip test files; they pose no production risk and many register
      // MSW handlers via fetch in setup.
      if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) continue;
      const rel = abs.split("/apps/web/")[1] ?? abs;
      if (rel === ALLOWED_FETCH_FILE) continue;
      const content = readFileSync(abs, "utf8");
      // Match `fetch(` not preceded by an identifier char or dot. Catches
      // `fetch(`, ` fetch(`, `\tfetch(` but not `apiFetch(` or `mockFetch(`.
      if (/(?<![\w.])fetch\s*\(/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `direct fetch() found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
