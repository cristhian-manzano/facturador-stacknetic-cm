/**
 * Centralised Zod-validated environment loader for apps/api.
 *
 * This is the ONLY file in `apps/api` permitted to access `process.env`
 * (enforced by `no-restricted-syntax` in @facturador/config/eslint, with a
 * targeted override for `**\/src/env.ts`).
 *
 * Scope for PROMPT-0003: just enough to boot the /health stub. SPEC-0006
 * widens the schema (DATABASE_URL, cookies, CORS, etc.) once that slice lands.
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  /**
   * Session TTL in minutes. Default 480 = 8h (matches PLAN-0010 §3 sliding
   * window). Bounded at the upper end at 30 days = 43_200 minutes because
   * any longer is the absolute cap from `createdAt` and not a sliding goal.
   */
  SESSION_TTL_MIN: z.coerce.number().int().positive().max(43_200).default(480),
  /**
   * Per-IP rate limit for `/api/v1/auth/login` (window 60 s). Default per
   * TASKS-0010 §7.1. Bounded so tests can dial it down via env.
   */
  AUTH_LOGIN_RATE_IP_PER_MIN: z.coerce.number().int().positive().max(10_000).default(5),
  /**
   * Per-email rate limit for `/api/v1/auth/login` (window 60 s). Default
   * 10/min per the same task. Email is lowercased before keying.
   */
  AUTH_LOGIN_RATE_EMAIL_PER_MIN: z.coerce.number().int().positive().max(10_000).default(10),
  // ---------------------------------------------------------------------
  // SRI-Core integration (SPEC-0020 §6.3 / PROMPT-0020).
  // The api mints HS256 service JWTs and POSTs to sri-core via this URL.
  // ---------------------------------------------------------------------
  /**
   * Shared HS256 secret used to mint service-to-service JWTs.
   * Optional in dev/test (defaults to a dev placeholder) so tests that
   * don't touch sri-core can boot without the env entry. Production must
   * provide a real ≥ 32 char value — enforced at the call site by
   * @facturador/utils/service-jwt.
   */
  SERVICE_JWT_SECRET: z.string().min(32, "SERVICE_JWT_SECRET must be ≥ 32 chars (256-bit entropy)"),
  /**
   * Base URL of the SRI-Core service. The api never calls SRI directly;
   * every outbound document call goes through this URL.
   */
  SRI_CORE_URL: z.string().url().default("http://localhost:3100"),
});

export type ApiEnv = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // No business logic here — exit fast with a readable error.
  // Using stderr/process.exit keeps this dependency-free (no logger yet).
  process.stderr.write(
    `[api/env] invalid environment:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}\n`,
  );
  process.exit(1);
}

export const env: ApiEnv = parsed.data;
