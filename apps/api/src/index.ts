/**
 * Boot entrypoint for apps/api.
 *
 * Reads `API_PORT` via the Zod-validated env loader, starts the Express app
 * produced by `createApp()`, and prints a single startup line. No process-env
 * access happens outside `env.ts`.
 */

import { createApp } from "./server.js";
import { env } from "./env.js";

const app = createApp();

app.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console -- bootstrap log; pino arrives in SPEC-0006
  console.log(`[api] listening on :${String(env.API_PORT)}`);
});
