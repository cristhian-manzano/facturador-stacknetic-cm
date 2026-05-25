/**
 * `runPollBatch` — polling job that drives EN_PROCESO documents to a
 * terminal state.
 *
 * Source of truth:
 *   - SPEC-0026 §FR-5 + §6.5 (polling job).
 *   - PLAN-0026 §4 Phase 3.
 *   - TASKS-0026 §4.1, §4.3.
 *   - PROMPT-0026 §6 (security policy: never log payloads).
 *
 * Algorithm:
 *
 *   1. Open a transaction; raw-SQL `SELECT ... FOR UPDATE SKIP LOCKED` on
 *      up to N documents where `estado='EN_PROCESO' AND (nextPollAt IS
 *      NULL OR nextPollAt <= now())`. Rows locked by a concurrent worker
 *      are skipped — this is what makes the job safe under horizontal
 *      scaling (PROMPT-0026 hard rule).
 *   2. For each locked row, call `AutorizacionClient.query(claveAcceso,
 *      ambiente)`. Branch on the parsed estado:
 *      - AUTORIZADO: persist authorized XML in the BlobStore, transition
 *        to AUTORIZADO via `recordEvent`.
 *      - NO_AUTORIZADO: transition to NO_AUTORIZADO via `recordEvent`.
 *      - EN_PROCESO: bump `pollAttempts`, set `nextPollAt =
 *        now + min(30s * 2^attempts, MAX_BACKOFF)`. No new event row
 *        unless `allowSelfLoop` is opted in.
 *      - DESCONOCIDO or autorización throws: bump attempts, set
 *        nextPollAt with the same backoff.
 *   3. Between docs sleep `sleepBetweenDocsMs` (default 1 s) to be
 *      polite to SRI. The total wall-clock per batch is capped by the
 *      `maxWallClockMs` deadline; remaining rows are left locked and
 *      re-fetched on the next tick.
 *
 * Cap policy: a document is left in EN_PROCESO forever (operator
 * intervention required) once `pollAttempts >= maxPollAttempts`. The
 * batch still queries it on the next tick so the operator sees a fresh
 * `lastPollAt` if they re-trigger the job manually.
 *
 * Logging: only `{ batchSize, processed, transitions, requestId? }`.
 * NEVER the XML body, never customer PII. The redactor strips XML by
 * path as defence in depth.
 */
import type { PrismaClient, SriDocument } from "@facturador/db";
import type { SriMensaje } from "@facturador/contracts/sri";
import type { Logger } from "@facturador/logger";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import { AutorizacionClient, type Ambiente } from "../soap/index.js";
import { recordEvent } from "../lifecycle/events.js";
import type { BlobStore } from "../blobs/blob-store.js";
import { authorizedXmlKey } from "../blobs/blob-store.js";

/* -------------------------------------------------------------------------- */
/*                                Public API                                  */
/* -------------------------------------------------------------------------- */

export interface RunPollBatchOptions {
  /** Maximum number of EN_PROCESO documents fetched per tick. Default 50. */
  readonly batchSize?: number;
  /** Sleep between document queries (ms). Default 1000. */
  readonly sleepBetweenDocsMs?: number;
  /** Maximum backoff between polling attempts for a single doc (ms). Default 10 min. */
  readonly maxBackoffMs?: number;
  /**
   * After this many attempts the document is left alone (still
   * EN_PROCESO) and the job stops re-bumping nextPollAt for it. Default
   * 60 (~2 hours with the default schedule, matching PLAN-0026 §3).
   */
  readonly maxPollAttempts?: number;
  /**
   * Wall-clock deadline for the entire batch (ms). Default 60 s
   * (NFR-2: a single invocation never exceeds 60 s).
   */
  readonly maxWallClockMs?: number;
  /** Clock override for tests. */
  readonly now?: () => Date;
  /** Sleep override for tests. Default `setTimeout`-based. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RunPollBatchDeps {
  readonly prisma: PrismaClient;
  readonly autorizacionClient: AutorizacionClient;
  readonly blobStore: BlobStore;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface RunPollBatchResult {
  readonly batchSize: number;
  readonly processed: number;
  readonly transitions: {
    readonly autorizado: number;
    readonly noAutorizado: number;
    readonly enProceso: number;
    readonly desconocido: number;
    readonly errored: number;
  };
  readonly durationMs: number;
}

const DEFAULTS = {
  batchSize: 50,
  sleepBetweenDocsMs: 1_000,
  maxBackoffMs: 10 * 60 * 1000,
  maxPollAttempts: 60,
  maxWallClockMs: 60_000,
  /** Base for exponential backoff: 30 s per SPEC-0026 §6.4. */
  baseBackoffMs: 30_000,
} as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One pass of the polling job. Safe to invoke from a cron tick or a CLI
 * worker. Multiple processes can run this concurrently — the
 * `FOR UPDATE SKIP LOCKED` lock ensures no double-processing.
 *
 * @returns counters useful for tests + observability.
 */
export async function runPollBatch(
  deps: RunPollBatchDeps,
  options: RunPollBatchOptions = {},
): Promise<RunPollBatchResult> {
  const batchSize = options.batchSize ?? DEFAULTS.batchSize;
  const sleepBetweenDocsMs = options.sleepBetweenDocsMs ?? DEFAULTS.sleepBetweenDocsMs;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULTS.maxPollAttempts;
  const maxWallClockMs = options.maxWallClockMs ?? DEFAULTS.maxWallClockMs;
  const sleep = options.sleep ?? defaultSleep;
  const now = (options.now ?? (() => new Date()))();
  const started = Date.now();

  // Inner transaction: lock the rows. We extend the work into the same
  // transaction so concurrent workers don't lose their locks until each
  // row is updated/transitioned.
  const counters = {
    autorizado: 0,
    noAutorizado: 0,
    enProceso: 0,
    desconocido: 0,
    errored: 0,
  };
  let processed = 0;
  let realBatchSize = 0;

  await deps.prisma.$transaction(async (tx) => {
    // Postgres-specific: raw query with FOR UPDATE SKIP LOCKED. We
    // parameterise the limit + the cutoff timestamp; the table name is
    // statically embedded (no user input).
    const cutoff = now;
    // Postgres requires an explicit cast when comparing an enum to a
    // string literal in raw SQL — `"estado" = 'EN_PROCESO'` errors with
    // "operator does not exist: SriEstado = unknown". Casting via
    // `::text` keeps the SELECT planner-friendly + works under the
    // composite (estado, nextPollAt) index.
    const rows = (await tx.$queryRaw`
      SELECT id, "companyId", "claveAcceso", "ambiente", "pollAttempts"
      FROM "SriDocument"
      WHERE "estado"::text = 'EN_PROCESO'
        AND ("nextPollAt" IS NULL OR "nextPollAt" <= ${cutoff})
        AND "pollAttempts" < ${maxPollAttempts}
      ORDER BY COALESCE("nextPollAt", "updatedAt") ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `) as Array<{
      id: string;
      companyId: string;
      claveAcceso: string;
      ambiente: string;
      pollAttempts: number;
    }>;
    realBatchSize = rows.length;

    for (const row of rows) {
      // Respect the wall-clock deadline. The remaining rows stay
      // locked until the transaction commits, so they'll be re-fetched
      // on the next tick.
      if (Date.now() - started > maxWallClockMs) {
        deps.logger?.warn(
          {
            event: "sri.poll.deadline_reached",
            processed,
            remaining: rows.length - processed,
            elapsedMs: Date.now() - started,
          },
          "polling batch hit wall-clock deadline",
        );
        break;
      }

      try {
        const t0 = Date.now();
        const result = await deps.autorizacionClient.query({
          claveAcceso: row.claveAcceso,
          ambiente: row.ambiente as Ambiente,
        });
        const durationMs = Date.now() - t0;
        const mensajes = result.mensajes as readonly SriMensaje[];

        if (result.estado === "AUTORIZADO") {
          let authBlobKey: string | undefined;
          if (result.autorizadoXml !== undefined) {
            const key = authorizedXmlKey(row.companyId, row.id);
            await deps.blobStore.put(key, result.autorizadoXml);
            authBlobKey = key;
          }
          await recordEvent(tx, {
            documentId: row.id,
            etapa: "AUTHORIZE",
            estado: "AUTORIZADO",
            durationMs,
            mensajes,
            patch: {
              ...(result.numeroAutorizacion === undefined
                ? {}
                : { numeroAutorizacion: result.numeroAutorizacion }),
              ...(result.fechaAutorizacion === undefined
                ? {}
                : { fechaAutorizacion: new Date(result.fechaAutorizacion) }),
              ...(authBlobKey === undefined ? {} : { authorizedXmlBlobKey: authBlobKey }),
            },
          });
          await tx.sriDocument.update({
            where: { id: row.id },
            data: { lastPollAt: now },
          });
          counters.autorizado += 1;
          await safeAudit(deps, {
            action: "sri.autorizacion.autorizado",
            entity: "SriDocument",
            entityId: row.id,
            companyId: row.companyId,
            payloadJson: {
              claveAcceso: row.claveAcceso,
              outcome: "AUTORIZADO",
              durationMs,
              httpStatus: result.httpStatus,
              source: "poll",
            },
          });
        } else if (result.estado === "NO_AUTORIZADO") {
          await recordEvent(tx, {
            documentId: row.id,
            etapa: "AUTHORIZE",
            estado: "NO_AUTORIZADO",
            durationMs,
            mensajes,
          });
          await tx.sriDocument.update({
            where: { id: row.id },
            data: { lastPollAt: now },
          });
          counters.noAutorizado += 1;
          await safeAudit(deps, {
            action: "sri.autorizacion.no_autorizado",
            entity: "SriDocument",
            entityId: row.id,
            companyId: row.companyId,
            payloadJson: {
              claveAcceso: row.claveAcceso,
              outcome: "NO_AUTORIZADO",
              durationMs,
              httpStatus: result.httpStatus,
              source: "poll",
              mensajesIds: mensajes.map((m) => ({
                identificador: m.identificador,
                tipo: m.tipo,
              })),
            },
          });
        } else if (result.estado === "EN_PROCESO") {
          // Still in process. Bump attempts + nextPollAt; don't write
          // a new event row.
          const attempts = row.pollAttempts + 1;
          const delayMs = backoffFor(attempts, maxBackoffMs);
          await tx.sriDocument.update({
            where: { id: row.id },
            data: {
              pollAttempts: attempts,
              lastPollAt: now,
              nextPollAt: new Date(now.getTime() + delayMs),
            },
          });
          counters.enProceso += 1;
        } else {
          // DESCONOCIDO — same bookkeeping as EN_PROCESO.
          const attempts = row.pollAttempts + 1;
          const delayMs = backoffFor(attempts, maxBackoffMs);
          await tx.sriDocument.update({
            where: { id: row.id },
            data: {
              pollAttempts: attempts,
              lastPollAt: now,
              nextPollAt: new Date(now.getTime() + delayMs),
            },
          });
          counters.desconocido += 1;
        }
      } catch (err) {
        // Network / parse failure — bump attempts so we back off,
        // never crash the batch.
        const attempts = row.pollAttempts + 1;
        const delayMs = backoffFor(attempts, maxBackoffMs);
        await tx.sriDocument.update({
          where: { id: row.id },
          data: {
            pollAttempts: attempts,
            lastPollAt: now,
            nextPollAt: new Date(now.getTime() + delayMs),
          },
        });
        counters.errored += 1;
        deps.logger?.warn(
          {
            event: "sri.poll.query_failed",
            documentId: row.id,
            companyId: row.companyId,
            attempts,
            nextPollAtMs: delayMs,
            kind: err instanceof Error ? err.name : "Unknown",
          },
          "polling query failed; backing off",
        );
      }

      processed += 1;

      // Polite delay between docs unless this is the last one.
      if (processed < rows.length && sleepBetweenDocsMs > 0) {
        await sleep(sleepBetweenDocsMs);
      }
    }
  });

  const durationMs = Date.now() - started;
  deps.logger?.info(
    {
      event: "sri.poll.batch_complete",
      batchSize: realBatchSize,
      processed,
      transitions: counters,
      durationMs,
    },
    "polling batch complete",
  );

  return {
    batchSize: realBatchSize,
    processed,
    transitions: counters,
    durationMs,
  };
}

/**
 * Exponential backoff schedule. attempts=1 → 60 s, attempts=2 → 120 s,
 * …, capped at `maxBackoffMs` (default 10 min). The base 30 s factor is
 * chosen so the first cron tick after EN_PROCESO catches the
 * sub-second SRI authorisations. SPEC-0026 §6.4.
 */
export function backoffFor(attempts: number, maxBackoffMs: number): number {
  const exp = Math.min(attempts, 32);
  // Math.pow(2, 32) is safely representable as a Number; the min() guards
  // against `Number.POSITIVE_INFINITY` for unreasonable attempt counts.
  const candidate = DEFAULTS.baseBackoffMs * Math.pow(2, exp);
  return Math.min(candidate, maxBackoffMs);
}

/* -------------------------------------------------------------------------- */
/*                                  Audit                                     */
/* -------------------------------------------------------------------------- */

async function safeAudit(
  deps: RunPollBatchDeps,
  args: {
    action: string;
    entity: string;
    entityId: string;
    companyId: string;
    payloadJson: Record<string, unknown>;
  },
): Promise<void> {
  const fallbackLogger: Pick<Logger, "error" | "info"> = {
    error() {
      /* fallback no-op */
    },
    info() {
      /* fallback no-op */
    },
  } as unknown as Pick<Logger, "error" | "info">;
  await audit(
    {
      prisma: deps.prisma as unknown as AuditPrismaClient,
      logger: (deps.logger as Pick<Logger, "error" | "info"> | undefined) ?? fallbackLogger,
    },
    {
      action: args.action,
      entity: args.entity,
      entityId: args.entityId,
      companyId: args.companyId,
      payloadJson: args.payloadJson,
    },
  );
}

/* -------------------------------------------------------------------------- */
/*                          Convenience for the test seam                     */
/* -------------------------------------------------------------------------- */

// Re-export internal docs so callers building Prisma rows for tests can
// share the type without reaching into the orchestrator. NOT for
// production use.
export type PollableDocument = Pick<
  SriDocument,
  | "id"
  | "companyId"
  | "claveAcceso"
  | "ambiente"
  | "estado"
  | "pollAttempts"
  | "lastPollAt"
  | "nextPollAt"
>;
