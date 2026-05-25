/**
 * Vitest config for `@facturador/logger`.
 *
 * The pretty transport spawns a worker; we suppress that by passing a
 * destination stream into `createLogger` in the redaction tests, which is
 * how production callers also opt out (`apps/api` uses stdout directly).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts",
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/**/__fixtures__/**",
        "src/env.ts",
      ],
    },
  },
});
