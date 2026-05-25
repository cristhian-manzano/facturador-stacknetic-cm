/**
 * `TenantSelectPage` tests (TASKS-0041 §5.2).
 *
 * Coverage:
 *   - Renders the membership list with role chips.
 *   - Click → POST `/api/v1/session/tenant { companyId }` once.
 *   - `queryClient.clear()` invoked.
 *   - Navigates to `/` after a successful switch.
 *   - Empty list message when memberships=[].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { TenantSelectPage } from "./TenantSelectPage.js";

const ME_TWO_TENANTS = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "ZULU S.A.",
      role: "OWNER" as const,
    },
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0HJNK",
      razonSocial: "ALPHA S.A.",
      role: "VIEWER" as const,
    },
  ],
  activeCompanyId: null,
  currentRole: null,
  permissions: [],
};

const ME_NO_TENANTS = {
  ...ME_TWO_TENANTS,
  memberships: [],
};

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookies(): void {
  for (const c of document.cookie.split("; ")) {
    const [k] = c.split("=");
    if (k !== undefined && k.length > 0) {
      document.cookie = `${k}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

function mount(initialState: unknown, queryClient?: QueryClient) {
  const routes: RouteObject[] = [
    { path: "/tenants/select", element: <TenantSelectPage /> },
    { path: "/", element: <div data-testid="home">HOME</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: ["/tenants/select"],
  });
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <AuthProvider initialState={initialState}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  clearCookies();
  setCookie("facturador_csrf", "initial-csrf-token");
});

describe("TenantSelectPage", () => {
  it("renders the list of tenants alphabetically with role chips", () => {
    mount(ME_TWO_TENANTS);
    const list = screen.getByTestId("tenant-list");
    expect(list).toBeInTheDocument();
    const options = screen.getAllByRole("button");
    // Alphabetical: ALPHA first, ZULU second.
    expect(options[0]).toHaveTextContent("ALPHA S.A.");
    expect(options[0]).toHaveTextContent("VIEWER");
    expect(options[1]).toHaveTextContent("ZULU S.A.");
    expect(options[1]).toHaveTextContent("OWNER");
  });

  it("renders the empty-state message when the user has no memberships", () => {
    mount(ME_NO_TENANTS);
    expect(screen.queryByTestId("tenant-list")).toBeNull();
    expect(screen.getByText(/No tienes empresas asignadas/i)).toBeInTheDocument();
  });

  it("on click, POSTs to /session/tenant, clears the cache and navigates to /", async () => {
    const calls: unknown[] = [];
    mswServer.use(
      http.post("/api/v1/session/tenant", async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json(
          {
            companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
            role: "OWNER",
            csrfToken: "rotated-token",
          },
          {
            status: 200,
            headers: {
              "Set-Cookie": "facturador_csrf=rotated-token; path=/",
            },
          },
        );
      }),
      http.get("/api/v1/me", () =>
        HttpResponse.json({
          ...ME_TWO_TENANTS,
          activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
          currentRole: "OWNER",
          permissions: ["invoice.read"],
        }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    mount(ME_TWO_TENANTS, queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-option-01KS5R6NXR0MY0X8SFHAH0GYHT"));

    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT" });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("shows an error banner when the switch fails", async () => {
    mswServer.use(
      http.post("/api/v1/session/tenant", () =>
        HttpResponse.json({ title: "Boom", status: 403, code: "no_membership" }, { status: 403 }),
      ),
    );

    mount(ME_TWO_TENANTS);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-option-01KS5R6NXR0MY0X8SFHAH0GYHT"));

    expect(await screen.findByTestId("tenant-select-error")).toHaveTextContent(
      /No pudimos cambiar/i,
    );
  });
});
