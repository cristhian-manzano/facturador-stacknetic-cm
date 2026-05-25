/**
 * Vitest config for `@facturador/db`.
 *
 * Built on the shared factory `defineFacturadorVitestConfig` so thresholds,
 * report formats, and pool options stay in sync with the rest of the
 * monorepo (SPEC-0007 §1, TASKS-0007 §1.2 / §1.3).
 *
 * The package has no per-test setup file today; the per-test schema harness
 * is opt-in per-block via `useTestSchema()`.
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/db",
  environment: "node",
  includeSetupFile: false,
  // The harness ships in `src/`, so it lands under default include patterns.
  // We carve out `src/index.ts` (already excluded by default) and the
  // generated client.  Coverage of the harness itself is exercised by
  // `test/test-harness-isolation*.test.ts`.
  coverageExcludeExtra: ["src/env.ts"],
});
