/**
 * `RequirePermission` — finer-grained guard on top of `RequireAuth`
 * (TASKS-0040 §4 / SPEC-0040 §4 / SPEC-0011 §FR-5).
 *
 * Usage (route element):
 *
 *   <RequirePermission action="invoice.read">
 *     <InvoicesPage />
 *   </RequirePermission>
 *
 * Redirects to `/forbidden` when the caller's `permissions` array (from
 * `/me`) does not include the requested action. The server is still the
 * authority — this guard is a UX hint that prevents a hard 403 round-trip.
 *
 * Order matters: callers wrap their tree with `RequireAuth` first so we
 * know the user is loaded. Calling this guard on `loading` returns the
 * spinner from `RequireAuth` (we never get here in that state).
 */
import { Navigate, Outlet } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

import type { Action } from "@facturador/utils/rbac";

import { useAuth } from "./context.js";

export interface RequirePermissionProps {
  action: Action;
  children?: ReactNode;
}

export function RequirePermission({ action, children }: RequirePermissionProps): ReactElement {
  const { permissions } = useAuth();

  if (!permissions.includes(action)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
