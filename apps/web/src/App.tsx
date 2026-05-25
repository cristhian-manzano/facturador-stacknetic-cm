/**
 * `App` — top-level composition for `@facturador/web`
 * (SPEC-0040 §6.4 / PLAN-0040 §4).
 *
 * Wires the providers around the data router:
 *   - `QueryClientProvider` (TanStack Query) for server state.
 *   - `AuthProvider` so route guards can read `useAuth()`.
 *   - `RouterProvider` mounts the data router.
 *
 * Query defaults:
 *   - `staleTime: 30s` — fiscal data is not real-time; refetching on
 *     every focus event is noisy.
 *   - `refetchOnWindowFocus: false` — explicit refresh actions only.
 *   - `retry: 1` — one retry then surface the error to the boundary.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { useState, type ReactElement } from "react";

import { AuthProvider } from "./auth/context.js";
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
