/**
 * `<CrossTabAuthBridge />` — invisible component that listens on the
 * BroadcastChannel for sign-out events and forces this tab to the login
 * page when it receives one.
 *
 * Why a component (not a hook in App.tsx)?
 *   - We need access to the React-Router `router` so we can
 *     `router.navigate("/login", { replace: true })`. The hook
 *     `useNavigate` only works INSIDE a Router subtree, but App.tsx wraps
 *     the RouterProvider. The data router exposes an imperative
 *     `navigate` method that works from outside any route.
 *   - We also need the QueryClient to clear cached server state.
 *
 * The component renders nothing — it just installs side effects.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactElement } from "react";

import { logger } from "../lib/logger.js";
import type { AppRouter } from "../routes/router.js";

import { subscribeAuthChannel } from "./cross-tab.js";

export interface CrossTabAuthBridgeProps {
  readonly router: AppRouter;
}

export function CrossTabAuthBridge({ router }: CrossTabAuthBridgeProps): ReactElement | null {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeAuthChannel(() => {
      logger.info("[cross-tab] signout received; clearing cache + navigating to /login");
      queryClient.clear();
      // Imperative navigation works on the data router regardless of which
      // route this component is mounted under.
      void router.navigate("/login", { replace: true });
    });
  }, [router, queryClient]);

  return null;
}
