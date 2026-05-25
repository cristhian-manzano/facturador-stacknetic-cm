/**
 * Vitest setup file for `@facturador/sri-core`.
 *
 * Pinned via the shared `defineFacturadorVitestConfig` setupFiles entry
 * (TASKS-0007 §3.4).  Mirror of `apps/api/test/setup.ts` minus MSW — sri-core
 * doesn't currently make outbound HTTP from tests (the live SRI SOAP client
 * lands in SPEC-0025).
 */
import { beforeAll } from "vitest";

beforeAll(() => {
  if (process.env["NODE_ENV"] === undefined) {
    process.env["NODE_ENV"] = "test";
  }
});
