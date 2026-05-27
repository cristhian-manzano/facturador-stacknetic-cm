/**
 * Background expired-session sweep.
 *
 * Source of truth: production-readiness §13.
 *
 *   - Removes `Session` rows whose `expiresAt` is older than 7 days. The
 *     application code already rejects expired rows at `loadSession`; the
 *     sweep is a hygiene measure so the table doesn't grow unbounded.
 *   - Runs daily at 03:15 UTC via `node-cron`.
 *   - Skips in `NODE_ENV=test` so the test runner doesn't accidentally
 *     start a long-lived timer (`server.ts` calls `scheduleSessionSweep`
 *     guarded by `env.NODE_ENV !== "test"`).
 *
 * The hand-callable `sweepExpiredSessions` returns the deleted row count
 * so a smoke test can verify the deletion semantics without waiting for
 * the cron tick.
 */
import cron from "node-cron";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

/**
 * The retention window beyond `expiresAt` before a row is purged.
 * Seven days gives operators time to forensically inspect a session
 * after its expiry (e.g. correlate against an incident timeline) before
 * the row leaves the table.
 */
const RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete every `Session` row whose `expiresAt` was more than
 * `RETENTION_DAYS` ago. Idempotent: a second call inside the window is
 * a no-op. Returns the deleted row count.
 */
export async function sweepExpiredSessions(
  prisma: PrismaClient,
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY);
  // eslint-disable-next-line @facturador/security/require-companyId-filter -- system-wide cleanup job; no tenant scope by design
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}

export interface SessionSweepDeps {
  prisma: PrismaClient;
  logger: Logger;
  /**
   * Override the cron expression. Default `15 3 * * *` (03:15 UTC daily).
   * Tests pass a more aggressive schedule to exercise the wiring.
   */
  cronExpression?: string;
}

export interface ScheduledTaskHandle {
  /** Stop the underlying cron task; idempotent. */
  stop(): void;
}

/**
 * Schedule the sweep. Returns a handle whose `stop()` cancels the task —
 * `server.ts` keeps a reference so HOT-reload / graceful-shutdown can
 * dispose of the cron worker cleanly.
 */
export function scheduleSessionSweep(deps: SessionSweepDeps): ScheduledTaskHandle {
  const expression = deps.cronExpression ?? "15 3 * * *";
  const task = cron.schedule(
    expression,
    () => {
      // Fire-and-forget. The inner promise NEVER throws — we log + swallow
      // so the cron loop keeps ticking.
      void (async () => {
        try {
          const count = await sweepExpiredSessions(deps.prisma);
          deps.logger.info(
            { event: "session.sweep.complete", deleted: count },
            "session_sweep_complete",
          );
        } catch (err) {
          deps.logger.error({ event: "session.sweep.failed", err }, "session_sweep_failed");
        }
      })();
    },
    { scheduled: true, timezone: "UTC" },
  );
  return {
    stop: () => {
      task.stop();
    },
  };
}
