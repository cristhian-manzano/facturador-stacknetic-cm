/**
 * Vitest setup file for `@facturador/web`.
 *
 * Loaded once per worker via the shared `defineFacturadorVitestConfig`
 * setupFiles entry (TASKS-0007 §3.4).
 *
 *   - Wires `@testing-library/jest-dom` matchers into Vitest's `expect`.
 *   - Boots an MSW node server with no handlers; each test registers its
 *     own.  `onUnhandledRequest: "error"` is strict — anything unmocked
 *     fails loud (PROMPT-0007 §2 "no real network").
 *   - Cleans the DOM after each test so Testing Library doesn't bleed
 *     state across cases.
 */
import { afterEach, beforeAll, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { mswServer } from "./msw/server.js";

expect.extend(matchers);

beforeAll(() => {
  if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "test";
  }
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
});

process.on("exit", () => {
  try {
    mswServer.close();
  } catch {
    // Worker exiting — best-effort.
  }
});
