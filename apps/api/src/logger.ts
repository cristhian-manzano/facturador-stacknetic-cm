/**
 * Process-wide Pino logger for apps/api.
 *
 * The factory reads `NODE_ENV` + `LOG_LEVEL` indirectly via the
 * `@facturador/logger` env loader (centralised secret).
 *
 * Per SPEC-0006 §6.9.
 */
import { createLogger, type Logger } from "@facturador/logger";
import { env } from "./env.js";

export const logger: Logger = createLogger({
  service: "api",
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
});
