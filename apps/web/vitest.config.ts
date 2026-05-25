/**
 * Vitest config for `@facturador/web`.
 *
 * Built on the shared factory `defineFacturadorVitestConfig` but selects the
 * jsdom environment for React/Testing-Library work (SPEC-0007 §6.7,
 * TASKS-0007 §3.3).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/web",
  environment: "jsdom",
  coverageIncludeExtra: ["src/**/*.tsx"],
  coverageExcludeExtra: [
    // Boot entrypoint is exercised by Vite at runtime, not by tests.
    "src/main.tsx",
  ],
});
