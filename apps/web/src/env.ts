/**
 * Zod-validated environment for `@facturador/web` (SPEC-0040 §6.1).
 *
 * Only `VITE_*` vars are exposed by Vite to the browser bundle. We default
 * `VITE_API_BASE_URL` to the empty string so the SPA hits its own origin
 * (the production deployment is intended to be same-origin behind a single
 * reverse proxy). In docker compose dev, the env is set to
 * `http://localhost:3000` so requests cross the api port.
 *
 * No secrets ever land here. The CSRF token is read from a cookie; sessions
 * live in `httpOnly` cookies (PROMPT-0040 §6, ai/context/security.md).
 */
import { z } from "zod";

const EnvSchema = z.object({
  /**
   * Base URL of the API. Empty string == same-origin (relative requests).
   * Otherwise an absolute URL like `http://localhost:3000`.
   */
  VITE_API_BASE_URL: z.string().default(""),
  /** App name used in the topbar / document title. */
  VITE_APP_NAME: z.string().min(1).default("Facturador"),
  /** Vite mode — used by tests to skip CSRF reads safely. */
  MODE: z.enum(["development", "test", "production"]).default("development"),
});

export type WebEnv = z.infer<typeof EnvSchema>;

const raw = import.meta.env as Record<string, string | undefined>;

export const env: WebEnv = EnvSchema.parse({
  VITE_API_BASE_URL: raw.VITE_API_BASE_URL ?? "",
  VITE_APP_NAME: raw.VITE_APP_NAME ?? "Facturador",
  MODE: raw.MODE ?? "development",
});
