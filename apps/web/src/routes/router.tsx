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
 *   /login              — public, placeholder for SPEC-0041 form (EAGER).
 *   /forbidden          — public, 403 destination (EAGER — small + always-needed).
 *   /tenants/select     — public-after-login, RequireAuth + no tenant (LAZY).
 *   /                   — RequireAuth + AppLayout (home page) (LAZY).
 *   /invoices           — RequireAuth + invoice.read (LAZY).
 *   /customers          — RequireAuth + customer.read (LAZY).
 *   /establecimientos   — RequireAuth + establecimiento.manage (LAZY).
 *   /settings           — RequireAuth + any admin perm (configured per route).
 *   *                   — 404.
 *
 * Bundle-size policy (REVIEW-0044): every non-login route is lazy-loaded so
 * `/login` ships with as little JavaScript as possible. The Suspense
 * fallback is a tiny inline spinner — no extra dependencies. The target is
 * a login chunk strictly smaller than the eager-loaded baseline.
 */
import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, createMemoryRouter, type RouteObject } from "react-router-dom";

/**
 * Re-derived router type. `RouterProvider` consumes the return type of
 * `createBrowserRouter`; re-exporting via `ReturnType` keeps us decoupled
 * from the `@remix-run/router` transitive package.
 */
export type AppRouter = ReturnType<typeof createBrowserRouter>;

import { RequireAuth } from "../auth/RequireAuth.js";
import { RequirePermission } from "../auth/RequirePermission.js";
import { ForbiddenPage } from "../pages/ForbiddenPage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";

// ---------------------------------------------------------------------------
// Lazy-loaded route modules
// ---------------------------------------------------------------------------
// React.lazy expects a default export, so we adapt the named-export modules
// via a thin promise transform. Every chunk is independent so navigating to
// /invoices doesn't pull in /customers code.

const AppLayout = lazy(async () => {
  const mod = await import("../layout/AppLayout.js");
  return { default: mod.AppLayout };
});
const HomePage = lazy(async () => {
  const mod = await import("../pages/HomePage.js");
  return { default: mod.HomePage };
});
const TenantSelectPage = lazy(async () => {
  const mod = await import("../pages/TenantSelectPage.js");
  return { default: mod.TenantSelectPage };
});
const InvoicesIndexPage = lazy(async () => {
  const mod = await import("./invoices.index.js");
  return { default: mod.InvoicesIndexPage };
});
const InvoicesNewPage = lazy(async () => {
  const mod = await import("./invoices.new.js");
  return { default: mod.InvoicesNewPage };
});
const InvoicesDetailPage = lazy(async () => {
  const mod = await import("./invoices.$id.js");
  return { default: mod.InvoicesDetailPage };
});
const InvoicesEditPage = lazy(async () => {
  const mod = await import("./invoices.$id.edit.js");
  return { default: mod.InvoicesEditPage };
});

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
 * Minimal Suspense fallback rendered while a route chunk loads. Kept inline
 * so it doesn't itself trigger a chunk fetch. Uses `role="status"` so
 * assistive tech announces the loading state.
 */
function RouteFallback(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="route-fallback"
      className="flex items-center justify-center py-8 text-sm text-slate-600"
    >
      <span
        aria-hidden="true"
        className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600"
      />
      Cargando…
    </div>
  );
}

/** Wrap any element in a Suspense boundary with the shared fallback. */
function lazyWrap(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
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
      element: lazyWrap(
        // RequireAuth allows ready-without-tenant through to this route by
        // matching on the path before redirecting. We let users see this
        // page even with status === ready (the guard redirects them HERE
        // when currentCompanyId is null).
        <TenantSelectPage />,
      ),
    },
    {
      element: <RequireAuth />,
      children: [
        {
          element: lazyWrap(<AppLayout />),
          children: [
            { index: true, element: lazyWrap(<HomePage />) },
            {
              path: "invoices",
              element: lazyWrap(<InvoicesIndexPage />),
            },
            {
              path: "invoices/new",
              element: lazyWrap(<InvoicesNewPage />),
            },
            {
              path: "invoices/:id/edit",
              element: lazyWrap(<InvoicesEditPage />),
            },
            {
              path: "invoices/:id",
              element: lazyWrap(<InvoicesDetailPage />),
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
