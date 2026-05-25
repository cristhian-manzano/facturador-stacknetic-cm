/**
 * `SignOutButton` tests (TASKS-0041 §4.1).
 *
 * Coverage:
 *   - On click, POSTs `/api/v1/auth/logout`.
 *   - Clears the TanStack Query cache.
 *   - Navigates to `/login` (replace, so back-button can't restore).
 *   - On network failure, still clears cache + still navigates (defence
 *     in depth).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { SignOutButton } from "./SignOutButton.js";

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

function mount(queryClient?: QueryClient) {
  const routes: RouteObject[] = [
    { path: "/", element: <SignOutButton /> },
    { path: "/login", element: <div data-testid="login">LOGIN</div> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <AuthProvider initialState={ME_READY}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("SignOutButton", () => {
  it("POSTs /auth/logout, clears the cache and navigates to /login", async () => {
    let logoutCalls = 0;
    mswServer.use(
      http.post("/api/v1/auth/logout", () => {
        logoutCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    mount(queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(screen.getByTestId("login")).toBeInTheDocument();
    });
    expect(logoutCalls).toBe(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("still clears the cache and navigates even on a 500 from the server", async () => {
    mswServer.use(
      http.post("/api/v1/auth/logout", () =>
        HttpResponse.json(
          { title: "boom", status: 500, code: "internal.unexpected" },
          { status: 500 },
        ),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    mount(queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(screen.getByTestId("login")).toBeInTheDocument();
    });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
