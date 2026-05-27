/**
 * Process-wide Pino logger for apps/sri-core.
 *
 * The factory reads `NODE_ENV` + `LOG_LEVEL` indirectly via the
 * `@facturador/logger` env loader (centralised secret).
 *
 * Per SPEC-0006 §6.9. Mirrors `apps/api/src/logger.ts` with `service:
 * "sri-core"` so log aggregators can route lines by service.
 */
import { createLogger, type Logger } from "@facturador/logger";

import { env } from "./env.js";

export const logger: Logger = createLogger({
  service: "sri-core",
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
});
