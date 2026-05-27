/**
 * Vitest config for `@facturador/contracts`.
 *
 * Uses the shared `defineFacturadorVitestConfig` factory (SPEC-0007 §1) so
 * pool options, reporter set, and per-package coverage thresholds stay in
 * sync with the rest of the monorepo. The contracts package overrides the
 * default thresholds to keep its historical 95% statement bar (the schemas
 * are pure data with no runtime branching).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/contracts",
  environment: "node",
  // No `test/setup.ts` in this package — contracts are pure Zod schemas
  // with no I/O to initialise.
  includeSetupFile: false,
  // Keep the historical bar from the previous hand-rolled config.
  coverageThresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
});
