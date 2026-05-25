/**
 * `burnSecuencial` — record a consumed secuencial in `BurnedSecuencial`.
 *
 * Source of truth:
 *   - SPEC-0030 §FR-4 + §6.2.
 *   - PLAN-0030 §4 Phase 5.
 *   - TASKS-0030 §3.1.
 *
 * Why this exists:
 *   - Once `reserveSecuencial` returns, the number is consumed for life.
 *     There is no release path. If the emission fails (SRI returns
 *     NO_AUTORIZADO/DEVUELTA, signing throws, or the network is down with
 *     no contingency window), the orchestrator MUST mark the number as
 *     burned and reserve a fresh one for the retry.
 *   - The burn row is forensic + analytics: operators can list burned
 *     ranges per emission point to understand drop-rates.
 *
 * Contract:
 *
 *   burnSecuencial(tx, input)
 *
 *   - `tx` accepts either a `PrismaClient` or a transaction-scoped tx.
 *     The helper writes a single row; if the caller wraps it inside a
 *     `prisma.$transaction(...)`, the burn participates in that
 *     transaction and rolls back with it. If the caller wants a
 *     fire-and-forget burn, they pass the top-level client.
 *
 * Hard rules:
 *   - `companyId` flows from server context — never the client body.
 *   - The (companyId, estab, ptoEmi, secuencial) tuple is uniqueness-
 *     constrained at the DB layer. A second burn of the same tuple
 *     throws `ConflictError("secuencial.already_burned")`. Callers
 *     wanting idempotent burns should catch and ignore.
 */
import { Prisma } from "@facturador/db";
import type { PrismaClient } from "@facturador/db";
import { newId } from "@facturador/db";
import { ConflictError } from "@facturador/utils/errors";

/**
 * Subset of `PrismaClient` we accept. Both a top-level client and a
 * `tx` (the value handed to a `$transaction` callback) implement this
 * surface, so the helper composes with either.
 */
export type BurnSecuencialTx = Pick<PrismaClient, "burnedSecuencial">;

export interface BurnSecuencialInput {
  readonly companyId: string;
  readonly estab: string;
  readonly ptoEmi: string;
  readonly tipoComprobante: string;
  /** 9-digit padded string as returned from `reserveSecuencial`. */
  readonly secuencial: string;
  /**
   * Free-form taxonomy: 'reissue' | 'manual' | 'emission_failure' |
   * 'devuelta' | 'no_autorizado'. Stored verbatim for analytics.
   */
  readonly reason: string;
  /** Optional acting user; null for system-driven burns (cron). */
  readonly burnedByUserId?: string | null;
  /** Optional pointer to the document that consumed the number. */
  readonly documentId?: string | null;
  /** Optional id override. Tests inject deterministic ids. */
  readonly id?: string;
}

/**
 * Insert a `BurnedSecuencial` row. Throws `ConflictError` with code
 * `secuencial.already_burned` if the (companyId, estab, ptoEmi,
 * secuencial) tuple is already present.
 */
export async function burnSecuencial(
  tx: BurnSecuencialTx,
  input: BurnSecuencialInput,
): Promise<{ id: string }> {
  const id = input.id ?? newId();
  try {
    await tx.burnedSecuencial.create({
      data: {
        id,
        companyId: input.companyId,
        estab: input.estab,
        ptoEmi: input.ptoEmi,
        tipoComprobante: input.tipoComprobante,
        secuencial: input.secuencial,
        reason: input.reason,
        burnedByUserId: input.burnedByUserId ?? null,
        documentId: input.documentId ?? null,
      },
    });
    return { id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("Secuencial already burned", "secuencial.already_burned", {
        cause: err,
      });
    }
    throw err;
  }
}
