/**
 * Smoke test for the web testing harness (TASKS-0007 §3.3 / §4.1 / §4.2).
 *
 *   - Asserts the jsdom environment is loaded by mounting a trivial
 *     `<div>Hello</div>` via `@testing-library/react` and reading it back.
 *   - Asserts `jest-dom` matchers are wired (`.toBeInTheDocument()`).
 *   - Drives the MSW server: registers the canonical `/api/v1/me` handler,
 *     fetches the URL, and asserts the response satisfies `MeResponseSchema`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MeResponseSchema } from "@facturador/contracts/auth";

import { handlers, API_BASE_URL } from "./msw/handlers.js";
import { mswServer } from "./msw/server.js";

describe("web smoke", () => {
  it("renders a trivial element through Testing Library", () => {
    render(<div>Hello</div>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("MSW returns a MeResponse-shaped payload for /api/v1/me", async () => {
    mswServer.use(...handlers);

    const res = await fetch(`${API_BASE_URL}/api/v1/me`);
    expect(res.status).toBe(200);

    const json: unknown = await res.json();
    const parsed = MeResponseSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.user.email).toMatch(/@facturador\.test$/);
    expect(parsed.data.memberships).toHaveLength(1);
  });
});
