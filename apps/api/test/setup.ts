/**
 * Vitest setup file for `@facturador/api`.
 *
 * Loaded once per worker via the shared `defineFacturadorVitestConfig`
 * setupFiles entry (TASKS-0007 §3.4).
 *
 *   - Forces `NODE_ENV=test` if not already set, so the logger picks
 *     the JSON-only transport and any future env-aware code path
 *     opts into deterministic behaviour.
 *   - Replaces nothing globally — the per-test logger override happens
 *     inside each test via `createTestLogger()` in `test/factory.ts`,
 *     so tests stay parallel-safe.
 *
 * Rationale (PROMPT-0007 §6 + SPEC-0007 §10):
 *   - No filesystem-bound transport here; the only place logs touch
 *     disk is `process.stdout`, never a file path.
 */
import { afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw/server.js";

beforeAll(() => {
  // Pin NODE_ENV before any module that branches on it loads further code.
  // Setting it inside `beforeAll` (not at module top level) keeps imports
  // pure for IDE tooling but still runs before the first test.
  if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "test";
  }
  // Start the MSW server with no handlers by default; each test registers
  // its own via `mswServer.use(...)`.
  //
  // MSW intercepts ALL HTTP via the Node fetch / http module, which means
  // Supertest's in-process requests to the Express app would also trip
  // `onUnhandledRequest`.  We therefore use `bypass` as the global default
  // — any test that wants strict behaviour can call `mswServer.listen({
  // onUnhandledRequest: "error" })` itself. Outbound calls to the SRI Core
  // stub host are still caught when handlers are registered (PROMPT-0007 §2
  // "no real network": there is no real `sri-core.test` to reach).
  mswServer.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  // Drop per-test handlers and reset to the empty baseline.  Without this,
  // a handler registered in test A would leak into test B.
  mswServer.resetHandlers();
});

// Shut down at the end of the worker.  Vitest runs setup files once per
// worker; using `afterAll` here would attach to whatever last `describe`
// imports this file, which is fragile. `process.on("exit")` is sufficient
// because MSW's `close()` is sync-friendly.
process.on("exit", () => {
  try {
    mswServer.close();
  } catch {
    // Worker is already exiting — best-effort cleanup.
  }
});
