/**
 * Vite config for `@facturador/web` (SPEC-0040 §6 / PLAN-0040 §4 Phase 1).
 *
 * Notes:
 *   - Binds to 0.0.0.0 so docker compose exposes the dev server on the host.
 *   - The dev server proxies `/api` to the api service so the SPA can issue
 *     same-origin requests (sidesteps CORS preflight in local dev). Outside
 *     docker, set `VITE_API_BASE_URL` to e.g. `http://localhost:3000`.
 *   - Tailwind / PostCSS pipeline is auto-resolved via `postcss.config.cjs`.
 *
 *   The target hostname `api` resolves inside the docker compose network
 *   (PROMPT-0003 §6.2). Tests don't use this server; Vitest mocks via MSW.
 */
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "");
  const apiTarget = localEnv.VITE_DEV_API_TARGET ?? "http://api:3000";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
    },
    build: {
      target: "es2022",
      sourcemap: true,
      rollupOptions: {
        // Split heavy dependencies into dedicated chunks so the LOGIN route
        // (the only eager-loaded route) doesn't pay the cost of code that
        // only the authenticated app actually needs.
        //
        //   - `vendor-react`     — React + ReactDOM + react-router (small,
        //                          shared across every route).
        //   - `vendor-query`     — TanStack Query (only used by routes that
        //                          fetch server data; not /login).
        //   - `vendor-rhf`       — react-hook-form + zod resolver (used by
        //                          LoginPage; small but separable so
        //                          authed-only routes can skip the resolver
        //                          if they don't use RHF).
        //   - `vendor-zod`      — zod schemas (used everywhere; isolate so
        //                          the parser tree is cached separately).
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-rhf": ["react-hook-form", "@hookform/resolvers"],
            "vendor-zod": ["zod"],
          },
        },
      },
    },
  };
});
