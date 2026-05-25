/**
 * Standalone polling worker entrypoint (`pnpm --filter @facturador/sri-core poll:once`).
 *
 * Source of truth:
 *   - SPEC-0026 §FR-5 (FOR UPDATE SKIP LOCKED + horizontal scalability).
 *   - PROMPT-0026 finishing-line validation: "a standalone polling
 *     worker entrypoint that scans EN_PROCESO and asks autorización".
 *
 * Usage:
 *
 *   - One-shot: `pnpm --filter @facturador/sri-core poll:once`
 *     (runs `runPollBatch` once with env-configured tuning and exits).
 *   - Forever: `pnpm --filter @facturador/sri-core poll:forever`
 *     (starts the node-cron scheduler in the foreground).
 *
 * The worker is intentionally separate from the API server so an
 * operator can spin up N polling-only pods that share locks via Postgres.
 */
import { prisma } from "@facturador/db";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { AutorizacionClient } from "../soap/index.js";
import { FilesystemBlobStore } from "../blobs/blob-store.js";
import { runPollBatch } from "./poll-en-proceso.js";
import { startPollingScheduler } from "./scheduler.js";

const mode = process.argv[2] ?? "once";

async function main(): Promise<void> {
  const autorizacionClient = new AutorizacionClient({
    env: {
      SRI_AUTORIZACION_URL_PRUEBAS: env.SRI_AUTORIZACION_URL_PRUEBAS,
      SRI_AUTORIZACION_URL_PRODUCCION: env.SRI_AUTORIZACION_URL_PRODUCCION,
      SRI_HTTP_TIMEOUT_MS: env.SRI_HTTP_TIMEOUT_MS,
    },
    logger,
  });
  const blobStore = new FilesystemBlobStore({ root: env.SRI_BLOB_FS_ROOT });

  if (mode === "once") {
    const result = await runPollBatch(
      {
        prisma,
        autorizacionClient,
        blobStore,
        logger,
      },
      {
        batchSize: env.SRI_POLL_BATCH_SIZE,
        sleepBetweenDocsMs: env.SRI_POLL_SLEEP_BETWEEN_DOCS_MS,
        maxBackoffMs: env.SRI_POLL_MAX_BACKOFF_MS,
      },
    );
    logger.info(
      {
        event: "sri.poll.once_complete",
        ...result,
      },
      "polling worker one-shot complete",
    );
    await prisma.$disconnect();
    return;
  }

  if (mode === "forever") {
    const handle = startPollingScheduler({
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
    });
    logger.info(
      { event: "sri.poll.scheduler_started_forever", cron: handle.cron },
      "polling worker scheduler online",
    );
    // Keep the process alive until SIGTERM/SIGINT.
    const shutdown = async (signal: string) => {
      logger.info({ event: "sri.poll.shutdown", signal }, "shutting down polling worker");
      handle.stop();
      await prisma.$disconnect();
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
    return;
  }

  // eslint-disable-next-line no-console -- CLI usage line
  console.error(`Unknown mode: ${mode}. Usage: poll:once | poll:forever`);
  process.exit(2);
}

main().catch((err: unknown) => {
  logger.error({ event: "sri.poll.worker_failed", err }, "polling worker crashed");
  process.exit(1);
});
