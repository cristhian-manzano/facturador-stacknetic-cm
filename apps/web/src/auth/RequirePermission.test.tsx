/**
 * `RequirePermission` route-guard tests (TASKS-0040 §6).
 *
 *   - Permission missing → redirects to `/forbidden`.
 *   - Permission present → renders children.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "./context.js";
import { RequirePermission } from "./RequirePermission.js";

const BASE_ME = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "STUB S.A.",
      role: "VIEWER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "VIEWER" as const,
};

function makeRouter() {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <RequirePermission action="invoice.read">
            <div data-testid="ok">OK</div>
          </RequirePermission>
        ),
      },
      {
        path: "/secret",
        element: (
          <RequirePermission action="certificate.manage">
            <div data-testid="secret">SECRET</div>
          </RequirePermission>
        ),
      },
      { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
    ],
    { initialEntries: ["/secret"] },
  );
}

describe("RequirePermission", () => {
  it("redirects to /forbidden when the action is missing from permissions", () => {
    render(
      <AuthProvider initialState={{ ...BASE_ME, permissions: ["invoice.read"] }}>
        <RouterProvider router={makeRouter()} />
      </AuthProvider>,
    );
    expect(screen.getByTestId("forbidden")).toBeInTheDocument();
  });

  it("renders children when the action is present", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <RequirePermission action="invoice.read">
              <div data-testid="ok">OK</div>
            </RequirePermission>
          ),
        },
        { path: "/forbidden", element: <div>FORBIDDEN</div> },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <AuthProvider initialState={{ ...BASE_ME, permissions: ["invoice.read"] }}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });
});
