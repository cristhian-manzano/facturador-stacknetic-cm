/**
 * Vitest config for `@facturador/utils`.
 *
 * Errors + audit live here; the audit suite touches Postgres via Prisma so
 * `dotenv -e ../../.env` is wired in the package.json `test` script (the same
 * pattern as `@facturador/db`).
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
    },
  },
});
