/**
 * `UserMenu` — topbar widget that shows the signed-in user + sign-out.
 *
 * Source of truth:
 *   - SPEC-0041 §6 + TASKS-0041 §4.1 — "UserMenu.tsx includes a 'Cerrar
 *     sesión' button calling apiFetch('/api/v1/auth/logout', { method:
 *     'POST' }), then auth.refresh()".
 *
 * Kept minimal for now (just the email + `SignOutButton`). A future spec
 * may add a popover with profile shortcuts. Splitting the email into this
 * widget keeps `AppLayout` focused on layout concerns.
 */
import type { ReactElement } from "react";

import { useAuth } from "../auth/context.js";
import { SignOutButton } from "./SignOutButton.js";

export function UserMenu(): ReactElement | null {
  const { user } = useAuth();
  if (user === null) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-slate-600 sm:inline" data-testid="user-email">
        {user.email}
      </span>
      <SignOutButton />
    </div>
  );
}
