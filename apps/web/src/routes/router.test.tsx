/**
 * Router smoke tests (TASKS-0040 §4.1).
 *
 * Mounts the route tree via the in-memory factory and asserts that the
 * critical routes render the expected component. Combined with the guard
 * tests in `auth/*.test.tsx` this gives us the redirect contract end-to-
 * end (route → guard → page) coverage.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { createTestRouter } from "./router.js";

const ME_OWNER = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "owner@facturador.test",
    displayName: "Owner",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "TEST S.A.",
      role: "OWNER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "OWNER" as const,
  permissions: [
    "tenant.read",
    "tenant.update",
    "customer.read",
    "invoice.read",
    "establecimiento.manage",
  ],
};

function mountAt(path: string, initialState?: unknown) {
  const router = createTestRouter([path]);
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider initialState={initialState}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("router", () => {
  it("renders /login as a public route", () => {
    mountAt("/login");
    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
  });

  it("renders /forbidden as a public route", () => {
    mountAt("/forbidden");
    expect(screen.getByRole("heading", { name: "Acceso denegado" })).toBeInTheDocument();
  });

  it("renders /tenants/select as a public-after-login route", () => {
    mountAt("/tenants/select", ME_OWNER);
    expect(screen.getByRole("heading", { name: "Selecciona una empresa" })).toBeInTheDocument();
  });

  it("renders the home page inside AppLayout for authenticated users", () => {
    mountAt("/", ME_OWNER);
    expect(screen.getByRole("heading", { level: 1, name: "Bienvenido" })).toBeInTheDocument();
  });

  it("renders invoices placeholder for OWNER (invoice.read)", () => {
    mountAt("/invoices", ME_OWNER);
    expect(screen.getByRole("heading", { name: "Facturas" })).toBeInTheDocument();
  });

  it("renders customers placeholder for OWNER (customer.read)", () => {
    mountAt("/customers", ME_OWNER);
    expect(screen.getByRole("heading", { name: "Clientes" })).toBeInTheDocument();
  });

  it("renders establecimientos placeholder for OWNER (establecimiento.manage)", () => {
    mountAt("/establecimientos", ME_OWNER);
    expect(screen.getByRole("heading", { name: "Establecimientos" })).toBeInTheDocument();
  });

  it("renders 404 for an unknown route", () => {
    mountAt("/this-does-not-exist");
    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor on '/' to /login", async () => {
    mswServer.use(
      http.get("/api/v1/me", () =>
        HttpResponse.json({ title: "u", status: 401, code: "auth.unauthorized" }, { status: 401 }),
      ),
    );
    mountAt("/");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    });
  });
});
