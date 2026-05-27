/**
 * Vitest config for `@facturador/config`.
 *
 * The package itself ships JS-only ESLint plugin code (in `./eslint/`) plus
 * a tiny TS shim under `src/`. Tests live next to the rule implementations
 * under `eslint/rules/__tests__/` so they're collocated with the code
 * being tested. The shared `defineFacturadorVitestConfig` factory expects
 * tests under `src/` only, so we use a thin custom config here rather
 * than the factory.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@facturador/config",
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx,js}", "eslint/**/__tests__/**/*.test.{ts,js}"],
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
      },
    },
  },
});
