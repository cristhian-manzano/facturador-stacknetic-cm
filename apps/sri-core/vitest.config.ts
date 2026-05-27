/**
 * Vitest config for `@facturador/sri-core`.
 *
 * Built on the shared factory `defineFacturadorVitestConfig` so thresholds,
 * report formats, and pool options match the rest of the monorepo
 * (SPEC-0007 §1, TASKS-0007 §3.2).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/sri-core",
  environment: "node",
  // The rotate-master-key + clave-acceso scripts live under `scripts/` and
  // ship their own *.test.ts files; pick them up in addition to the
  // standard src/test patterns.
  includeExtra: ["scripts/**/*.test.{ts,tsx}"],
  coverageExcludeExtra: ["src/index.ts", "src/env.ts"],
});
