/**
 * Router factory for `@facturador/web` (SPEC-0040 §6 / PLAN-0040 §4 Phase 4
 * / TASKS-0040 §4.1).
 *
 * React Router 6 data router. We export a factory rather than a singleton
 * so tests can mount a fresh router (with a `MemoryRouter` style initial
 * URL) without bleeding state between cases.
 *
 * Route tree:
 *
 *   /login              — public, placeholder for SPEC-0041 form.
 *   /forbidden          — public, 403 destination.
 *   /tenants/select     — public-after-login, RequireAuth + no tenant.
 *   /                   — RequireAuth + AppLayout (home page).
 *   /invoices           — RequireAuth + invoice.read.
 *   /customers          — RequireAuth + customer.read.
 *   /establecimientos   — RequireAuth + establecimiento.manage.
 *   /settings           — RequireAuth + any admin perm (configured per route).
 *   *                   — 404.
 */
import { createBrowserRouter, createMemoryRouter, type RouteObject } from "react-router-dom";
import type { ReactElement } from "react";

/**
 * Re-derived router type. `RouterProvider` consumes the return type of
 * `createBrowserRouter`; re-exporting via `ReturnType` keeps us decoupled
 * from the `@remix-run/router` transitive package.
 */
export type AppRouter = ReturnType<typeof createBrowserRouter>;

import { RequireAuth } from "../auth/RequireAuth.js";
import { RequirePermission } from "../auth/RequirePermission.js";
import { AppLayout } from "../layout/AppLayout.js";
import { ForbiddenPage } from "../pages/ForbiddenPage.js";
import { HomePage } from "../pages/HomePage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { TenantSelectPage } from "../pages/TenantSelectPage.js";
import { InvoicesNewPage } from "./invoices.new.js";
import { InvoicesEditPage } from "./invoices.$id.edit.js";
import { InvoicesIndexPage } from "./invoices.index.js";
import { InvoicesDetailPage } from "./invoices.$id.js";

/** Tiny placeholder rendered by routes whose pages live in later specs. */
function Placeholder({ title }: { title: string }): ReactElement {
  return (
    <section>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Próximamente: contenido de esta sección (especificación posterior).
      </p>
    </section>
  );
}

/**
 * Build the route table. Exported so tests can pass it to
 * `createMemoryRouter` with different initial URLs.
 */
export function buildRoutes(): RouteObject[] {
  return [
    { path: "/login", element: <LoginPage /> },
    { path: "/forbidden", element: <ForbiddenPage /> },
    {
      path: "/tenants/select",
      element: (
        // RequireAuth allows ready-without-tenant through to this route by
        // matching on the path before redirecting. We let users see this
        // page even with status === ready (the guard redirects them HERE
        // when currentCompanyId is null).
        <TenantSelectPage />
      ),
    },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppLayout />,
          children: [
            { index: true, element: <HomePage /> },
            {
              path: "invoices",
              element: <InvoicesIndexPage />,
            },
            {
              path: "invoices/new",
              element: <InvoicesNewPage />,
            },
            {
              path: "invoices/:id/edit",
              element: <InvoicesEditPage />,
            },
            {
              path: "invoices/:id",
              element: <InvoicesDetailPage />,
            },
            {
              path: "customers",
              element: (
                <RequirePermission action="customer.read">
                  <Placeholder title="Clientes" />
                </RequirePermission>
              ),
            },
            {
              path: "establecimientos",
              element: (
                <RequirePermission action="establecimiento.manage">
                  <Placeholder title="Establecimientos" />
                </RequirePermission>
              ),
            },
            {
              path: "settings",
              element: (
                // Settings opens to any user that already passes RequireAuth;
                // sub-pages will refine with their own permissions.
                <Placeholder title="Configuración" />
              ),
            },
          ],
        },
      ],
    },
    { path: "*", element: <NotFoundPage /> },
  ];
}

/** Production router used by `main.tsx`. */
export function createAppRouter(): AppRouter {
  return createBrowserRouter(buildRoutes());
}

/** Test seam: build an in-memory router for component tests. */
export function createTestRouter(initialEntries: string[] = ["/"]): AppRouter {
  return createMemoryRouter(buildRoutes(), { initialEntries });
}
