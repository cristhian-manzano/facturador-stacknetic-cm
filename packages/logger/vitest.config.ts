/**
 * Vitest config for `@facturador/logger`.
 *
 * Migrated to the shared `defineFacturadorVitestConfig` factory (SPEC-0007 §1).
 * The pretty transport spawns a worker; we suppress that by passing a
 * destination stream into `createLogger` in the redaction tests, which is
 * how production callers also opt out (`apps/api` uses stdout directly).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/logger",
  environment: "node",
  // No setup file — the logger has no env-dependent side-effects.
  includeSetupFile: false,
  coverageExcludeExtra: ["src/env.ts"],
});
