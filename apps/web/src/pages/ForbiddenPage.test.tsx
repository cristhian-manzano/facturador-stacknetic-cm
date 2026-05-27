/**
 * `ForbiddenPage` rendering test (TASKS-0041 §4.3).
 *
 * Asserts the 403 page exposes a heading + brief explanation + back-to-
 * home CTA. Snapshots are intentionally minimal; this is the destination
 * for `RequirePermission` and the global `auth:403` handler, so the page
 * needs to stay readable + actionable.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ForbiddenPage } from "./ForbiddenPage.js";

describe("ForbiddenPage", () => {
  it("renders heading, explanation and a back-to-home link", () => {
    render(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Acceso denegado" })).toBeInTheDocument();
    expect(screen.getByText(/no tienes permisos/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Volver al inicio" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });
});
