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
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

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
    },
  };
});
