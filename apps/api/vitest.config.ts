/**
 * Vitest config for `@facturador/api`.
 *
 * Consumes the shared factory `defineFacturadorVitestConfig` from
 * `@facturador/config/vitest` — one source of truth for thresholds, report
 * formats, and pool options (SPEC-0007 §1, TASKS-0007 §3.1).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/api",
  environment: "node",
  coverageExcludeExtra: [
    // Boot entrypoint is exercised by the platform, not by tests.
    "src/index.ts",
    // Centralised env loader is validated by integration up the stack.
    "src/env.ts",
  ],
});
