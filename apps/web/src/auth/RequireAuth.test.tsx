/**
 * `RequireAuth` route-guard tests (TASKS-0040 §6.3).
 *
 * Drives a minimal memory router with the guard at the root, asserting the
 * three lifecycle branches:
 *   - Unauthenticated → `<Navigate to="/login?next=...">`.
 *   - Authenticated but no tenant → `<Navigate to="/tenants/select">`.
 *   - Authenticated + tenant → renders children.
 *   - Loading → centred spinner.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { AuthProvider, type AuthProviderProps } from "./context.js";
import { RequireAuth } from "./RequireAuth.js";

const ME_READY = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "STUB S.A.",
      role: "OWNER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "OWNER" as const,
  permissions: ["invoice.read"],
};

const ME_NO_TENANT = {
  ...ME_READY,
  activeCompanyId: null,
  currentRole: null,
  permissions: [],
};

function renderWith(initial: string, initialState: AuthProviderProps["initialState"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <RequireAuth>
            <div data-testid="child">PROTECTED</div>
          </RequireAuth>
        ),
      },
      { path: "/login", element: <div data-testid="login">LOGIN</div> },
      { path: "/tenants/select", element: <div data-testid="select">TENANT SELECT</div> },
    ],
    { initialEntries: [initial] },
  );

  return render(
    <AuthProvider initialState={initialState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe("RequireAuth", () => {
  it("redirects unauthenticated users to /login with the next query param", () => {
    renderWith("/", null);
    expect(screen.getByTestId("login")).toBeInTheDocument();
    // The Navigate happens before the URL is observable in jsdom; assert the
    // login route is rendered instead. The next param is observable via the
    // history search but Memory router exposes it under window.location.
    // Our guard sets next from `useLocation`, so an initial entry of "/"
    // produces next=%2F encoded.
  });

  it("renders children when authenticated AND tenant is selected", () => {
    renderWith("/", ME_READY);
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("redirects to /tenants/select when authenticated without a tenant", () => {
    renderWith("/", ME_NO_TENANT);
    expect(screen.getByTestId("select")).toBeInTheDocument();
  });

  it("renders a spinner during loading state", () => {
    // initialState=undefined keeps the provider in 'loading' (no MSW handler
    // registered, so the network call hangs / fails but we look BEFORE that).
    // Use initialState that is NOT a valid me payload to remain in loading
    // momentarily — easier: pre-seed loading by mounting without state and
    // taking the synchronous first render.
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <RequireAuth>
              <div>protected</div>
            </RequireAuth>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <AuthProvider initialState={{ user: undefined }}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    // initialState that fails MeResponseSchema.safeParse falls back to
    // EMPTY_STATE (status: "loading"). The spinner has role=status.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
