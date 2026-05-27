/**
 * `App` — top-level composition for `@facturador/web`
 * (SPEC-0040 §6.4 / PLAN-0040 §4 / REVIEW-0044 §UX hardening).
 *
 * Wires the providers around the data router:
 *   - `ErrorBoundary` outermost — catches render-time bugs anywhere below.
 *   - `OfflineBanner` — surfaces a sticky banner when `navigator.onLine`
 *     flips to false.
 *   - `QueryClientProvider` (TanStack Query) for server state.
 *   - `AuthProvider` so route guards can read `useAuth()`.
 *   - `CrossTabAuthBridge` listens for multi-tab signout messages and
 *     navigates to /login.
 *   - `RouterProvider` mounts the data router.
 *   - `ToastContainer` lives last so its absolute-positioned shell paints
 *     above the rest of the tree.
 *
 * Query defaults:
 *   - `staleTime: 30s` — fiscal data is not real-time; refetching on
 *     every focus event is noisy.
 *   - `refetchOnWindowFocus: false` — explicit refresh actions only.
 *   - `retry: 1` — one retry then surface the error to the boundary.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { RouterProvider } from "react-router-dom";

import { ErrorBoundary } from "./app/ErrorBoundary.js";
import { OfflineBanner } from "./app/OfflineBanner.js";
import { ToastContainer } from "./app/ToastContainer.js";
import { AuthProvider } from "./auth/context.js";
import { CrossTabAuthBridge } from "./auth/CrossTabAuthBridge.js";
import type { AppRouter } from "./routes/router.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export interface AppProps {
  router: AppRouter;
}

export function App({ router }: AppProps): ReactElement {
  // useState keeps the QueryClient stable across re-renders without leaking
  // across StrictMode double-mount.
  const [queryClient] = useState<QueryClient>(() => createQueryClient());

  return (
    <ErrorBoundary>
      <OfflineBanner />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CrossTabAuthBridge router={router} />
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
      <ToastContainer />
    </ErrorBoundary>
  );
}
