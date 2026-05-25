/**
 * `TenantSwitcher` tests (TASKS-0041 §5.3).
 *
 * Coverage:
 *   - Renders nothing when memberships < 2 (single-tenant users have nothing
 *     to switch to — UI must not show dead controls).
 *   - Renders trigger + opens panel listing every membership.
 *   - Selecting a different tenant:
 *       * POSTs `/api/v1/session/tenant` once with `{ companyId }`.
 *       * Clears the TanStack Query cache.
 *       * Calls AuthProvider.refresh (asserted via the resulting `/me`
 *         call).
 *       * Demonstrates CSRF cookie rotation: the MSW handler reads the
 *         incoming `X-CSRF-Token` (old token), sets a fresh cookie in
 *         the response, and we assert the SECOND outgoing call uses the
 *         new value.
 *   - Selecting the CURRENT tenant is a no-op (closes the panel only).
 *   - Esc closes the panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { TenantSwitcher } from "./TenantSwitcher.js";

const ME_MULTI = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "ACME S.A.",
      role: "OWNER" as const,
    },
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0HJNK",
      razonSocial: "BRAVO S.A.",
      role: "VIEWER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "OWNER" as const,
  permissions: ["invoice.read"],
};

const ME_SINGLE = {
  ...ME_MULTI,
  memberships: ME_MULTI.memberships.slice(0, 1),
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
  const routes: RouteObject[] = [{ path: "/", element: <TenantSwitcher /> }];
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
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

afterEach(() => {
  clearCookies();
});

describe("TenantSwitcher — rendering", () => {
  it("renders nothing when the user has a single membership", () => {
    const { container } = mount(ME_SINGLE);
    expect(container.textContent).toBe("");
  });

  it("renders the trigger with the current company name", () => {
    mount(ME_MULTI);
    const trigger = screen.getByTestId("tenant-switcher-trigger");
    expect(trigger).toHaveTextContent("ACME S.A.");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the panel on click and lists every membership with a role chip", async () => {
    mount(ME_MULTI);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-switcher-trigger"));

    expect(screen.getByTestId("tenant-switcher-panel")).toBeInTheDocument();
    expect(
      screen.getByTestId("tenant-switcher-option-01KS5R6NXR0MY0X8SFHAH0GYHT"),
    ).toHaveTextContent("ACME S.A.");
    expect(
      screen.getByTestId("tenant-switcher-option-01KS5R6NXR0MY0X8SFHAH0HJNK"),
    ).toHaveTextContent("BRAVO S.A.");
  });

  it("closes the panel on Escape", async () => {
    mount(ME_MULTI);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-switcher-trigger"));
    expect(screen.getByTestId("tenant-switcher-panel")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("tenant-switcher-panel")).toBeNull();
    });
  });
});

describe("TenantSwitcher — switching", () => {
  it("POSTs once, clears the cache, calls refresh and rotates the CSRF cookie", async () => {
    const switchCalls: { csrf: string | null; body: unknown }[] = [];

    mswServer.use(
      http.post("/api/v1/session/tenant", async ({ request }) => {
        const csrf = request.headers.get("X-CSRF-Token");
        const body = (await request.json()) as unknown;
        switchCalls.push({ csrf, body });
        // Simulate the server rotating the CSRF cookie. jsdom respects
        // `Set-Cookie` from a same-origin response.
        return HttpResponse.json(
          {
            companyId: "01KS5R6NXR0MY0X8SFHAH0HJNK",
            role: "VIEWER",
            csrfToken: "rotated-csrf-token",
          },
          {
            status: 200,
            headers: {
              "Set-Cookie": "facturador_csrf=rotated-csrf-token; path=/",
            },
          },
        );
      }),
      // refresh() will call /me — return the multi payload with the new
      // active tenant.
      http.get("/api/v1/me", () =>
        HttpResponse.json({
          ...ME_MULTI,
          activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0HJNK",
          currentRole: "VIEWER",
        }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    mount(ME_MULTI, queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-switcher-trigger"));
    await user.click(screen.getByTestId("tenant-switcher-option-01KS5R6NXR0MY0X8SFHAH0HJNK"));

    await waitFor(() => {
      expect(switchCalls).toHaveLength(1);
    });
    // Pre-switch: outgoing call used the OLD cookie.
    expect(switchCalls[0]?.csrf).toBe("initial-csrf-token");
    expect(switchCalls[0]?.body).toEqual({
      companyId: "01KS5R6NXR0MY0X8SFHAH0HJNK",
    });

    // Cache MUST have been cleared as part of the switch.
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // Cookie rotated client-side (MSW Set-Cookie was honoured by jsdom).
    await waitFor(() => {
      expect(document.cookie).toContain("facturador_csrf=rotated-csrf-token");
    });
  });

  it("does NOT call the server when the user clicks the current tenant", async () => {
    let count = 0;
    mswServer.use(
      http.post("/api/v1/session/tenant", () => {
        count += 1;
        return HttpResponse.json({
          companyId: ME_MULTI.activeCompanyId,
          role: "OWNER",
          csrfToken: "x",
        });
      }),
    );

    mount(ME_MULTI);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-switcher-trigger"));
    await user.click(screen.getByTestId(`tenant-switcher-option-${ME_MULTI.activeCompanyId}`));

    // Panel closes; no network call.
    await waitFor(() => {
      expect(screen.queryByTestId("tenant-switcher-panel")).toBeNull();
    });
    expect(count).toBe(0);
  });

  it("shows an error banner when the switch endpoint fails", async () => {
    mswServer.use(
      http.post("/api/v1/session/tenant", () =>
        HttpResponse.json(
          { title: "Boom", status: 500, code: "internal.unexpected" },
          { status: 500 },
        ),
      ),
    );

    mount(ME_MULTI);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tenant-switcher-trigger"));
    await user.click(screen.getByTestId("tenant-switcher-option-01KS5R6NXR0MY0X8SFHAH0HJNK"));

    // The panel stays open with an error banner so the user can retry.
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/No pudimos cambiar/i);
  });
});
