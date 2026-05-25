/**
 * `RequireAuth` — route guard wrapping authenticated pages
 * (SPEC-0040 §4 / PLAN-0040 §4 Phase 4 / TASKS-0040 §4.2).
 *
 * Behaviour:
 *   - `status === "loading"`: renders a centred spinner. Children stay
 *     unmounted so we don't trigger downstream fetches while auth is
 *     unknown.
 *   - `status === "unauthenticated"`: navigates to `/login?next=<encoded
 *     current location>`. The login flow (SPEC-0041) reads `next` and
 *     redirects on success.
 *   - `status === "ready"` but no `currentCompanyId`: navigates to
 *     `/tenants/select` so the user picks a tenant before any tenant-
 *     scoped query runs.
 *   - Otherwise renders `<Outlet />` (or `children` if used as a wrapper).
 *
 * The redirect is always `replace: true` so the unauthenticated route
 * doesn't pollute the browser back stack.
 */
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

import { useAuth } from "./context.js";

interface RequireAuthProps {
  /** Allow nesting either as a wrapper or via `<Outlet />`. */
  children?: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps): ReactElement {
  const { status, currentCompanyId } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-full min-h-[60vh] items-center justify-center"
      >
        <span
          aria-label="Cargando"
          className="block h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600"
        />
      </div>
    );
  }

  if (status === "unauthenticated" || status === "error") {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (currentCompanyId === null) {
    return <Navigate to="/tenants/select" replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
