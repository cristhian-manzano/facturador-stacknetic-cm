/**
 * Vitest config for `@facturador/contracts`.
 *
 * Coverage targets per TASKS-0005 §11.1: statement coverage >= 95%.
 * Subpath-exported domains live under `src/<domain>/` and each schema file
 * has a sibling `.test.ts`.
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
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
