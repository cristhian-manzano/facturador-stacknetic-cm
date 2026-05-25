/**
 * Centralised Zod-validated env loader for `@facturador/logger`.
 *
 * Only ENV variables that affect logger initialisation are read here:
 *   - `NODE_ENV`  drives whether the pretty transport is enabled.
 *   - `LOG_LEVEL` is the default log level when the caller does not override.
 *
 * This file is the ONLY one in the package permitted to touch `process.env`
 * (enforced by the shared ESLint flat config's per-file override for
 * `**\/src/env.ts`). All other code receives values via injected options.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type LoggerEnv = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(
    `[logger/env] invalid environment:\n${JSON.stringify(
      parsed.error.flatten().fieldErrors,
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

export const env: LoggerEnv = parsed.data;
