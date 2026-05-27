/**
 * Vitest config for `@facturador/utils`.
 *
 * Migrated to the shared `defineFacturadorVitestConfig` factory (SPEC-0007 §1).
 * The audit suite touches Postgres via Prisma, so `dotenv -e ../../.env` is
 * wired in the package.json `test` script (the same pattern as `@facturador/db`).
 */
import { defineFacturadorVitestConfig } from "@facturador/config/vitest";

export default defineFacturadorVitestConfig({
  packageName: "@facturador/utils",
  environment: "node",
  // No `test/setup.ts` in this package — env defaults come from the
  // dotenv-cli wrapper around `pnpm test`.
  includeSetupFile: false,
});
