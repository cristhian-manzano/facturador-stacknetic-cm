/**
 * `SignOutButton` — single-purpose component that ends the session.
 *
 * Source of truth:
 *   - SPEC-0041 §FR-4 / TASKS-0041 §4.1.
 *   - PROMPT-0041 hard constraint — "Sign-out: clear the cache, redirect
 *     to /login".
 *
 * Behaviour:
 *   1. POST `/api/v1/auth/logout` via `auth.signOut()` (which uses
 *      `apiFetch` so CSRF is honoured).
 *   2. Always — even on network failure — call `queryClient.clear()` so
 *      no tenant-scoped data lingers in the cache for the next user.
 *   3. Navigate to `/login` (replace, so back-button can't restore the
 *      logged-in shell).
 *
 * Why is the cache clear here AND in `auth.signOut()`?
 *   - `auth.signOut()` only clears the auth context (it has no direct
 *     handle on TanStack Query). The cache lives outside auth — this
 *     button is where the two are joined.
 *
 * Accessibility:
 *   - Renders as a real `<button>` so screen readers describe it.
 *   - The "busy" state surfaces via `aria-busy="true"` while the request
 *     is in flight.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/context.js";
import { broadcastSignout } from "../auth/cross-tab.js";
import { t } from "../i18n/es.js";
import { cn } from "../lib/cn.js";

export interface SignOutButtonProps {
  className?: string;
}

export function SignOutButton({ className }: SignOutButtonProps): ReactElement {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback((): void => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await signOut();
      } finally {
        // Always clear the cache + redirect. `signOut` is best-effort
        // even when the network fails, so the UI must end up in a clean
        // logged-out state regardless.
        queryClient.clear();
        // Notify other tabs so they also drop the logged-in shell. The
        // BroadcastChannel API gracefully no-ops in browsers that don't
        // support it (see `cross-tab.ts`).
        broadcastSignout();
        navigate("/login", { replace: true });
        setBusy(false);
      }
    })();
  }, [busy, navigate, queryClient, signOut]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      data-testid="sign-out-button"
      className={cn(
        "rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {t("nav.signOut")}
    </button>
  );
}
