/**
 * Centralised Zod-validated environment loader for apps/sri-core.
 *
 * This is the ONLY file in `apps/sri-core` permitted to access `process.env`
 * (enforced by `no-restricted-syntax` in @facturador/config/eslint, with a
 * targeted override for `**\/src/env.ts`).
 *
 * Source of truth:
 *   - SPEC-0020 §6.2 (variable list).
 *   - PLAN-0020 §3 (stub-mode policy: refuse to boot in production).
 *   - TASKS-0020 §2.1.
 *
 * The schema is exported alongside the parsed singleton so tests can call
 * `parseEnv(...)` on an in-memory payload — without that, the
 * production+stub-mode refusal would be untestable without spawning a
 * subprocess.
 */

import { z } from "zod";

// `SRI_STUB_MODE` arrives as a string from the shell — we coerce manually to
// keep the parsed shape strict and the wire format obvious.
const BoolFromStringSchema = z.enum(["true", "false"]).transform((v) => v === "true");

export const SriCoreEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    SRI_CORE_PORT: z.coerce.number().int().positive().max(65_535).default(3100),
    // Connection string for Prisma. Host-side tests + tools resolve this from
    // `.env`; in compose, docker-compose.yml overrides with the in-network
    // hostname (`db`).
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // Shared HS256 secret minted by api and verified here. Must be a non-empty
    // string — the @facturador/utils helper rejects an empty secret too, but
    // we want a clean boot-time failure rather than a runtime one.
    SERVICE_JWT_SECRET: z
      .string()
      .min(32, "SERVICE_JWT_SECRET must be ≥ 32 chars (256-bit entropy)"),
    // SRI SOAP endpoints + ambiente defaults.
    SRI_RECEPCION_URL_PRUEBAS: z.string().url(),
    SRI_AUTORIZACION_URL_PRUEBAS: z.string().url(),
    SRI_RECEPCION_URL_PRODUCCION: z.string().url(),
    SRI_AUTORIZACION_URL_PRODUCCION: z.string().url(),
    SRI_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
    // Master key for the .p12 envelope. SPEC-0021 §6.1 requires AES-256
    // (32-byte key). The string must be exactly 64 hex characters. We
    // intentionally do NOT print the value in the failure path; the schema
    // message names the rule and the env loader's `parseEnv` echoes a
    // sanitised flatten() result with the offending key but not the value
    // (Zod's default behaviour). In SRI_STUB_MODE we relax the format
    // requirement to a min-length placeholder so the dev `.env.example`
    // continues to boot the service in stub mode without committing real
    // key material; the refine below enforces the strict 64-hex shape
    // whenever stub mode is OFF.
    SRI_CERT_MASTER_KEY_HEX: z.string().min(32),
    // Stub mode for local dev / tests. NEVER allowed in production — see
    // refine below.
    SRI_STUB_MODE: BoolFromStringSchema.default("false"),
    // XAdES-BES signing algorithm (SPEC-0024). SHA1 is the historical SRI
    // default (most existing certificates still emit it); SHA256 is opt-in
    // and exercises the modern path. The selection is server-side only —
    // never accepted from a request body (PROMPT-0024 §6).
    SRI_SIGN_ALGO: z.enum(["SHA1", "SHA256"]).default("SHA1"),
    // Filesystem root for the dev BlobStore (SPEC-0026 §6.6). Production
    // deployments swap the FilesystemBlobStore for an S3 / GCS impl; this
    // var has no effect there. Default `./.blobs` is resolved relative to
    // `process.cwd()` by the FilesystemBlobStore constructor and is
    // `.gitignore`d at the repo root.
    SRI_BLOB_FS_ROOT: z.string().min(1).default("./.blobs"),
    // Polling cadence + ceiling (SPEC-0026 §4 FR-5, PLAN-0026 §3). The
    // values default to: cron */2 * * * * with a 50-doc batch, 1s sleep
    // between docs, and exponential backoff capped at 10 minutes per
    // attempt. The total deadline (5 min) is enforced by the orchestrator
    // — beyond that the document is left in EN_PROCESO for operator
    // intervention.
    SRI_POLL_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
    SRI_POLL_SLEEP_BETWEEN_DOCS_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(10_000)
      .default(1_000),
    SRI_POLL_MAX_BACKOFF_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000)
      .default(10 * 60 * 1000),
    SRI_POLL_TOTAL_DEADLINE_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1000)
      .default(5 * 60 * 1000),
    SRI_POLL_CRON: z.string().min(1).default("*/2 * * * *"),
  })
  // Hard rule from PROMPT-0020: stub mode must refuse to boot in production.
  // Hard rule from PROMPT-0021: in any non-stub mode the master key must be
  // EXACTLY 64 hex characters (32 bytes). Stub mode keeps the loose check
  // to support the in-repo `.env.example` placeholder.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.SRI_STUB_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SRI_STUB_MODE"],
        message:
          "stub_mode_in_production: SRI_STUB_MODE=true is forbidden when NODE_ENV=production",
      });
    }
    if (!env.SRI_STUB_MODE) {
      const value = env.SRI_CERT_MASTER_KEY_HEX;
      const isHex = /^[0-9a-fA-F]{64}$/u.test(value);
      if (!isHex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SRI_CERT_MASTER_KEY_HEX"],
          message:
            "invalid_master_key: SRI_CERT_MASTER_KEY_HEX must be 64 hex characters (32 bytes) when SRI_STUB_MODE is off",
        });
      }
    }
  });

export type SriCoreEnv = z.infer<typeof SriCoreEnvSchema>;

/**
 * Parse an env payload (defaults to `process.env`). Exported so tests can
 * assert the refine rejection without spawning a subprocess.
 *
 * Throws on validation failure with a precise message — including the
 * `stub_mode_in_production` sentinel that PROMPT-0020 §6 requires for
 * the refuse-to-boot test.
 */
export function parseEnv(source: NodeJS.ProcessEnv): SriCoreEnv {
  const result = SriCoreEnvSchema.safeParse(source);
  if (!result.success) {
    const flat = result.error.flatten().fieldErrors;
    throw new Error(`[sri-core/env] invalid environment:\n${JSON.stringify(flat, null, 2)}`);
  }
  return result.data;
}

// Parse once at module load. A failure exits the process with code 1 so
// the supervisor (compose / orchestrator) observes the refuse-to-boot.
let parsed: SriCoreEnv;
try {
  parsed = parseEnv(process.env);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}

export const env: SriCoreEnv = parsed;
