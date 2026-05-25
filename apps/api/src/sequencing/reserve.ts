/**
 * `reserveSecuencial` — atomic secuencial reservation under Serializable
 * isolation.
 *
 * Source of truth:
 *   - SPEC-0030 §FR-3 + §6.1.
 *   - PLAN-0030 §4 Phase 2.
 *   - TASKS-0030 §2.1.
 *   - PROMPT-0030 hard constraints (retry budget, no release path).
 *
 * Contract:
 *
 *   reserveSecuencial(
 *     { prisma },
 *     { companyId, estab, ptoEmi, tipoComprobante }
 *   ): Promise<string>
 *
 *   - Returns a 9-digit, left-zero-padded string in [000000001, 999999999].
 *   - On serialization conflict (Postgres SQLSTATE 40001 / Prisma P2034), the
 *     helper retries up to MAX_RETRIES times with jittered backoff before
 *     surfacing `ConflictError("secuencial.exhausted_retries")`.
 *   - On overflow (counter value > 999_999_999), throws
 *     `ConflictError("invoice.sequential_overflow")`.
 *
 * Hard rules captured here:
 *   - `companyId` is NEVER read from a client body — it must come from
 *     `req.companyId` (populated by `requireTenant`) and is passed in by
 *     the handler.
 *   - Once the row counter has been incremented and the transaction has
 *     committed, the returned number is consumed for life. The caller MUST
 *     either persist it on a `SriDocument` (success path) or audit-burn it
 *     via `burnSecuencial`. There is no `releaseSecuencial`.
 *   - The reservation row counter starts at 0 and the very first reservation
 *     atomically upserts it to 1. The function deliberately uses raw SQL
 *     (`INSERT ... ON CONFLICT DO UPDATE SET value = ... + 1 RETURNING`)
 *     so there is exactly one round-trip and the Serializable retry budget
 *     stays predictable.
 *
 * Why Serializable: SPEC-0030 §6.1 — the read-then-update pattern (or upsert)
 * is conflict-free only at Serializable. Postgres surfaces concurrent retries
 * as `40001 serialization_failure`; Prisma maps that to `P2034`. Both codes
 * are caught and retried below.
 */
import { Prisma } from "@facturador/db";
import type { PrismaClient } from "@facturador/db";
import { ConflictError } from "@facturador/utils/errors";

/** Upper bound on the secuencial space (SRI: 9 digits, 1..999_999_999). */
export const SECUENCIAL_MAX = 999_999_999;

/** Pad a non-negative integer to a 9-digit string. */
function pad9(n: number): string {
  return n.toString().padStart(9, "0");
}

/**
 * Minimal Prisma surface the helper requires. We accept the full
 * `PrismaClient` (or any compatible stub) so the helper stays unit-testable
 * — no module-level singletons.
 */
export interface ReserveSecuencialDeps {
  readonly prisma: PrismaClient;
  /**
   * Override the retry count. Defaults to {@link DEFAULT_MAX_RETRIES}.
   * Tests use a lower number to exercise the exhaustion path quickly.
   */
  readonly maxRetries?: number;
  /**
   * Sleep helper, injectable for deterministic tests. The default uses a
   * jittered setTimeout; tests pass a no-op `() => Promise.resolve()`.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReserveSecuencialArgs {
  readonly companyId: string;
  readonly estab: string;
  readonly ptoEmi: string;
  readonly tipoComprobante: string;
}

/** Default retry budget — 3 retries (4 attempts total). */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * Real sleep with jittered backoff between [50, 200) ms — used in
 * production. Tests inject a no-op via `deps.sleep`.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect a Postgres serialization conflict surfaced through Prisma. We
 * deliberately allow-list the codes so any other Prisma error short-
 * circuits to the caller. Several shapes are tolerated:
 *
 *   - `Prisma.PrismaClientKnownRequestError` with `code === "P2034"` (the
 *     supported public surface — Prisma's "Transaction failed due to a
 *     write conflict or a deadlock").
 *   - `Prisma.PrismaClientKnownRequestError` with `code === "P2010"` and
 *     `meta.code === "40001"` (the `$queryRaw` path used here: Prisma
 *     wraps a raw-query failure in P2010 and stuffs the SQLSTATE in
 *     `meta.code`).
 *   - Any error whose `code === "40001"` (raw Postgres SQLSTATE forwarded
 *     verbatim by a transaction-level COMMIT failure).
 */
function isSerializationConflict(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return true;
    // Prisma surfaces raw SQLSTATEs in `meta.code` for `$queryRaw` failures.
    const meta = err.meta as { code?: string } | undefined;
    if (meta?.code === "40001") return true;
    // Some commit-time conflicts come back as a generic message; fall
    // through and check the message text as a last resort.
    if (
      err.code === "P2010" &&
      typeof err.message === "string" &&
      err.message.includes("could not serialize access")
    ) {
      return true;
    }
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (code === "40001" || code === "P2034") return true;
  }
  return false;
}

/**
 * Atomically reserve the next secuencial for `(companyId, estab, ptoEmi,
 * tipoComprobante)`. See module header for full contract.
 */
export async function reserveSecuencial(
  deps: ReserveSecuencialDeps,
  args: ReserveSecuencialArgs,
): Promise<string> {
  const { prisma } = deps;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = deps.sleep ?? defaultSleep;

  let attempt = 0;
  let lastErr: unknown;

  // Attempts: 1 initial + maxRetries retries = (maxRetries + 1) total.
  while (attempt <= maxRetries) {
    try {
      const value = await prisma.$transaction(
        async (tx) => {
          // Single-statement upsert + increment + RETURNING. The SQL is the
          // same row touched by every concurrent worker, so Serializable
          // surfaces the conflict reliably (a plain `update` would also
          // work but the upsert handles the cold-start case in the same
          // round-trip).
          //
          // The `WHERE` predicate in the EXCLUDED clause is identity; we
          // bump `value = secuencial_counters.value + 1` and RETURN the
          // post-increment value as a BIGINT.
          const rows = await tx.$queryRaw<{ next: bigint }[]>`
            INSERT INTO "secuencial_counters" (
              "companyId", "estab", "ptoEmi", "tipoComprobante", "value", "updatedAt"
            )
            VALUES (
              ${args.companyId}, ${args.estab}, ${args.ptoEmi}, ${args.tipoComprobante}, 1, NOW()
            )
            ON CONFLICT ("companyId", "estab", "ptoEmi", "tipoComprobante")
            DO UPDATE SET
              "value" = "secuencial_counters"."value" + 1,
              "updatedAt" = NOW()
            RETURNING "value" AS "next"
          `;
          if (rows.length === 0 || rows[0] === undefined) {
            // Defensive: RETURNING always yields a row on insert/update.
            throw new ConflictError(
              "Secuencial reservation produced no row",
              "secuencial.unexpected",
            );
          }
          const next = Number(rows[0].next);
          if (!Number.isFinite(next) || next < 1) {
            throw new ConflictError(
              "Secuencial reservation produced an invalid value",
              "secuencial.unexpected",
            );
          }
          if (next > SECUENCIAL_MAX) {
            // Overflow is permanent — no point retrying.
            throw new ConflictError("Secuencial space exhausted", "invoice.sequential_overflow");
          }
          return next;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
      return pad9(value);
    } catch (err) {
      // Overflow is permanent; bubble immediately.
      if (err instanceof ConflictError && err.code === "invoice.sequential_overflow") {
        throw err;
      }
      if (!isSerializationConflict(err)) {
        // Anything that isn't a serialization conflict bubbles unchanged.
        throw err;
      }
      lastErr = err;
      attempt += 1;
      if (attempt > maxRetries) break;
      // Jittered backoff: 50ms base × (1 + attempt) plus 0–100ms jitter.
      // Caps at ~250ms before the final attempt — keeps tail latency
      // predictable while still spreading concurrent retrigger.
      const base = 50 * attempt;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(base + jitter);
    }
  }

  throw new ConflictError(
    "Secuencial reservation exhausted retry budget",
    "secuencial.exhausted_retries",
    { cause: lastErr instanceof Error ? lastErr : undefined },
  );
}
