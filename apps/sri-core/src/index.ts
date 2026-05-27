/**
 * Boot entrypoint for apps/sri-core.
 *
 * Reads `SRI_CORE_PORT` via the Zod-validated env loader, starts the Express
 * app produced by `createApp()`, and prints a single startup line. No
 * process-env access happens outside `env.ts`.
 */

import { prisma } from "@facturador/db";

import { FilesystemBlobStore } from "./blobs/blob-store.js";
import { startExpiryJob } from "./certificates/expiry-job.js";
import { env } from "./env.js";
import { getDefaultPollingHealth } from "./jobs/polling-health.js";
import { startPollingScheduler } from "./jobs/scheduler.js";
import { logger } from "./logger.js";
import { createApp } from "./server.js";
import { AutorizacionClient } from "./soap/index.js";
import { warmXsdValidator } from "./xml/warm.js";

const app = createApp({ pollingHealth: getDefaultPollingHealth() });

app.listen(env.SRI_CORE_PORT, () => {
  // eslint-disable-next-line no-console -- bootstrap log; pino arrives in SPEC-0006
  console.log(`[sri-core] listening on :${String(env.SRI_CORE_PORT)}`);
  // Warm the XSD validator after the listener is up so the boot log
  // line lands before the warmer's. The warm is best-effort and
  // never blocks the server from accepting requests.
  void warmXsdValidator(logger);
});

// SPEC-0021 §6.7 + TASKS-0021 §7.2: schedule the daily expiry check.
// Skip when NODE_ENV === "test" so unit/integration tests never see a
// stray scheduled task interfere with their isolated schemas.
if (env.NODE_ENV !== "test") {
  startExpiryJob({ prisma, logger });

  // SPEC-0026 §FR-5 + PROMPT-0026 §6 — start the polling scheduler.
  // Stub mode skips the scheduler too: in stub mode the orchestrator
  // never leaves a document in EN_PROCESO, so the scheduler would have
  // nothing to do (and would still call out to SRI URLs that may not
  // resolve in dev).
  if (!env.SRI_STUB_MODE) {
    const autorizacionClient = new AutorizacionClient({
      env: {
        SRI_AUTORIZACION_URL_PRUEBAS: env.SRI_AUTORIZACION_URL_PRUEBAS,
        SRI_AUTORIZACION_URL_PRODUCCION: env.SRI_AUTORIZACION_URL_PRODUCCION,
        SRI_HTTP_TIMEOUT_MS: env.SRI_HTTP_TIMEOUT_MS,
      },
      logger,
    });
    const blobStore = new FilesystemBlobStore({ root: env.SRI_BLOB_FS_ROOT });
    startPollingScheduler({
      prisma,
      autorizacionClient,
      blobStore,
      cron: env.SRI_POLL_CRON,
      batchOptions: {
        batchSize: env.SRI_POLL_BATCH_SIZE,
        sleepBetweenDocsMs: env.SRI_POLL_SLEEP_BETWEEN_DOCS_MS,
        maxBackoffMs: env.SRI_POLL_MAX_BACKOFF_MS,
      },
      logger,
      // Wire the same shared polling-health state passed to createApp
      // so `/readyz` reflects the live scheduler's last batch timestamp.
      pollingHealth: getDefaultPollingHealth(),
    });
  }
}
