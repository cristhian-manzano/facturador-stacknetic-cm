/**
 * `<App />` smoke test (SPEC-0040 §6.4 / TASKS-0040 §6).
 *
 * Mounts the full provider tree with an in-memory router and an auth
 * provider seeded into the `unauthenticated` state. The point is to
 * exercise the wiring (QueryClient + Auth + RouterProvider) — not to
 * re-test the underlying components.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";
import { createTestRouter } from "./routes/router.js";

describe("App", () => {
  it("mounts the provider tree and renders the matched route", () => {
    render(<App router={createTestRouter(["/login"])} />);
    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
  });
});
