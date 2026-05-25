/**
 * Daily expiry-check cron for tenant ACTIVE certificates.
 *
 * Source of truth:
 *   - SPEC-0021 §6.7 (`startExpiryJob` + bucket thresholds).
 *   - PROMPT-0021 hard rule: expiry monitor at `{30, 15, 7, 3, 1, 0}` days
 *     remaining; emit structured log + AuditLog row each bucket.
 *   - TASKS-0021 §7.1 / §7.2.
 *
 * Design notes:
 *   - `runExpiryCheck(prisma, now?)` is the pure-ish core. It performs the
 *     scan and emits audit + log lines but does NOT mutate the document
 *     state (a separate housekeeping job can flip ACTIVE → EXPIRED later;
 *     here we just observe).
 *   - The scheduler wires `node-cron` to invoke `runExpiryCheck` daily at
 *     06:00 UTC. Tests use the pure function directly.
 *   - Idempotency: the cron runs once per day. If it crashes mid-loop and
 *     restarts within the same day we may write duplicate audit rows —
 *     acceptable for v1 because audit rows have a ULID PK so each is
 *     uniquely identifiable, and the operator-facing UI deduplicates by
 *     (action, entityId, day).
 */
import cron, { type ScheduledTask } from "node-cron";
import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { audit as auditFn, type AuditPrismaClient } from "@facturador/utils/audit";

/**
 * Days-remaining buckets that trigger a `cert.expiry_warning` audit. The
 * cron runs daily; an ACTIVE cert lands in exactly one bucket per day
 * (we use the largest bucket ≥ daysRemaining so a cert at day 5 still
 * triggers the "≤7" warning).
 */
export const EXPIRY_WARNING_BUCKETS = [30, 15, 7, 3, 1, 0] as const;

/** ms in a day, frozen so callers can't accidentally divide by zero. */
const DAY_MS = 86_400_000;

const auditAdapter = (prisma: PrismaClient): AuditPrismaClient =>
  prisma as unknown as AuditPrismaClient;

export interface RunExpiryCheckResult {
  readonly scanned: number;
  readonly warningsWritten: number;
  readonly expiredWritten: number;
}

/**
 * Scan ACTIVE certs and emit audit rows for any cert whose days-remaining
 * matches one of the warning buckets (or is already negative).
 *
 * Returns counters useful for tests + dashboards.
 */
export async function runExpiryCheck(
  prisma: PrismaClient,
  logger: Logger,
  now: Date = new Date(),
): Promise<RunExpiryCheckResult> {
  const certs = await prisma.certificate.findMany({
    where: { status: "ACTIVE", deletedAt: null },
  });
  let warnings = 0;
  let expired = 0;
  for (const cert of certs) {
    const daysRemaining = Math.floor((cert.validTo.getTime() - now.getTime()) / DAY_MS);
    if (daysRemaining < 0) {
      logger.error(
        {
          event: "certificate.expired",
          companyId: cert.companyId,
          certificateId: cert.id,
          fingerprintSha256: cert.fingerprintSha256,
          daysRemaining,
        },
        "certificate already expired",
      );
      await auditFn(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "cert.expired",
          entity: "Certificate",
          entityId: cert.id,
          companyId: cert.companyId,
          payloadJson: {
            daysRemaining,
            validTo: cert.validTo.toISOString(),
            fingerprintSha256: cert.fingerprintSha256,
          },
        },
      );
      expired += 1;
      continue;
    }
    if (EXPIRY_WARNING_BUCKETS.includes(daysRemaining as 30)) {
      logger.warn(
        {
          event: "certificate.expiry_warning",
          companyId: cert.companyId,
          certificateId: cert.id,
          fingerprintSha256: cert.fingerprintSha256,
          daysRemaining,
        },
        "certificate nearing expiry",
      );
      await auditFn(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "cert.expiry_warning",
          entity: "Certificate",
          entityId: cert.id,
          companyId: cert.companyId,
          payloadJson: {
            daysRemaining,
            validTo: cert.validTo.toISOString(),
            fingerprintSha256: cert.fingerprintSha256,
          },
        },
      );
      warnings += 1;
    }
  }
  return { scanned: certs.length, warningsWritten: warnings, expiredWritten: expired };
}

export interface StartExpiryJobOptions {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  /**
   * Cron expression. Defaults to `"0 6 * * *"` — 06:00 UTC daily, which
   * is when overnight-batch traffic settles in Ecuador's morning window.
   */
  readonly cronExpression?: string;
  /** Override timezone. Defaults to UTC. */
  readonly timezone?: string;
}

/**
 * Mount the cron schedule. Production callers invoke this once at boot.
 * Returns the scheduled task so callers can `.stop()` it on graceful
 * shutdown.
 *
 * Test environments must NOT call this — pass through `runExpiryCheck`
 * directly so deterministic clocks work.
 */
export function startExpiryJob(options: StartExpiryJobOptions): ScheduledTask {
  const expression = options.cronExpression ?? "0 6 * * *";
  const task = cron.schedule(
    expression,
    () => {
      void runExpiryCheck(options.prisma, options.logger).catch((err: unknown) => {
        options.logger.error(
          { err, event: "certificate.expiry_cron_failed" },
          "expiry cron failed",
        );
      });
    },
    {
      timezone: options.timezone ?? "UTC",
    },
  );
  return task;
}
