/**
 * `AppLayout` permission-gating tests (TASKS-0040 §5.1 + §6.4).
 *
 *   - VIEWER role: Facturas + Clientes visible; Configuración hidden.
 *   - OWNER role: all gated entries visible.
 *   - Topbar exposes the tenant chip with the current company name.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "../auth/context.js";

import { AppLayout } from "./AppLayout.js";

const VIEWER_ME = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "viewer@facturador.test",
    displayName: "Viewer",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "ACME S.A.",
      role: "VIEWER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "VIEWER" as const,
  // VIEWER can read invoices + customers but cannot manage tenant /
  // establecimiento / certificate.
  permissions: ["invoice.read", "customer.read"],
};

const OWNER_ME = {
  ...VIEWER_ME,
  user: { ...VIEWER_ME.user, email: "owner@facturador.test" },
  memberships: [
    {
      companyId: VIEWER_ME.memberships[0]?.companyId ?? "",
      razonSocial: VIEWER_ME.memberships[0]?.razonSocial ?? "",
      role: "OWNER" as const,
    },
  ],
  currentRole: "OWNER" as const,
  permissions: [
    "tenant.read",
    "tenant.update",
    "tenant.manage_members",
    "customer.read",
    "customer.create",
    "customer.update",
    "customer.delete",
    "invoice.read",
    "invoice.create",
    "invoice.emit",
    "invoice.reissue",
    "certificate.manage",
    "establecimiento.manage",
  ],
};

function mount(me: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppLayout />,
        children: [{ index: true, element: <div data-testid="home">HOME</div> }],
      },
      { path: "/login", element: <div>LOGIN</div> },
    ],
    { initialEntries: ["/"] },
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialState={me}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AppLayout", () => {
  it("renders the tenant chip with the active company's razón social", () => {
    mount(VIEWER_ME);
    expect(screen.getByTestId("tenant-chip").textContent).toBe("ACME S.A.");
  });

  it("VIEWER sees Inicio + Facturas + Clientes, hides Establecimientos + Configuración", () => {
    mount(VIEWER_ME);
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clientes" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Establecimientos" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Configuración" })).toBeNull();
  });

  it("OWNER sees every nav link", () => {
    mount(OWNER_ME);
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clientes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Establecimientos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configuración" })).toBeInTheDocument();
  });

  it("exposes the sign-out button", () => {
    mount(VIEWER_ME);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("renders the user email in the topbar", () => {
    mount(OWNER_ME);
    expect(screen.getByTestId("user-email").textContent).toBe("owner@facturador.test");
  });
});
