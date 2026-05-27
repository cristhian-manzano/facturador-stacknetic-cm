/**
 * Cron scheduler glue for the polling job.
 *
 * Source of truth:
 *   - SPEC-0026 FR-5 (cron expression "every 2 minutes").
 *   - TASKS-0026 §4.3.
 *   - PROMPT-0026 §6 (NODE_ENV !== "test" guard).
 *
 * The scheduler is a thin wrapper around `node-cron`. It exists so the
 * server boot can call `startPollingScheduler(...)` once and forget;
 * tests don't import this module, they call `runPollBatch` directly.
 */
import cron, { type ScheduledTask } from "node-cron";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

import type { BlobStore } from "../blobs/blob-store.js";
import { AutorizacionClient } from "../soap/index.js";

import { runPollBatch, type RunPollBatchOptions } from "./poll-en-proceso.js";
import type { PollingHealthState } from "./polling-health.js";

export interface StartPollingSchedulerOptions {
  readonly prisma: PrismaClient;
  readonly autorizacionClient: AutorizacionClient;
  readonly blobStore: BlobStore;
  /** Cron expression. Default is the "every 2 minutes" pattern. */
  readonly cron?: string;
  /** Default batch tuning forwarded into `runPollBatch`. */
  readonly batchOptions?: RunPollBatchOptions;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  /**
   * Optional polling-health state. When set, the scheduler stamps
   * `recordBatchCompleted` after each successful batch. The `/readyz`
   * route reads this same state so a stale subsystem reports 503.
   */
  readonly pollingHealth?: PollingHealthState;
}

export interface PollingSchedulerHandle {
  readonly cron: string;
  /** Cancel the underlying cron task. Safe to call multiple times. */
  stop(): void;
}

/**
 * Start the polling scheduler. Returns a handle the caller can use to
 * stop the task on shutdown. The task body swallows errors so a single
 * batch failure never tears down the cron.
 */
export function startPollingScheduler(
  options: StartPollingSchedulerOptions,
): PollingSchedulerHandle {
  const cronExpr = options.cron ?? "*/2 * * * *";
  const task: ScheduledTask = cron.schedule(
    cronExpr,
    () => {
      void (async () => {
        try {
          await runPollBatch(
            {
              prisma: options.prisma,
              autorizacionClient: options.autorizacionClient,
              blobStore: options.blobStore,
              ...(options.logger === undefined ? {} : { logger: options.logger }),
            },
            options.batchOptions ?? {},
          );
          // Stamp polling health on success — the /readyz route reads
          // this to decide whether the polling subsystem is alive.
          options.pollingHealth?.recordBatchCompleted();
        } catch (err) {
          options.logger?.error(
            {
              event: "sri.poll.tick_failed",
              err,
            },
            "polling tick failed",
          );
        }
      })();
    },
    { scheduled: true },
  );
  options.logger?.info(
    { event: "sri.poll.scheduler_started", cron: cronExpr },
    "polling scheduler started",
  );
  return {
    cron: cronExpr,
    stop() {
      task.stop();
    },
  };
}
