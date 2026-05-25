/**
 * `recordEvent()` — transactional helper that ALL state mutations go through.
 *
 * Source of truth:
 *   - SPEC-0020 hard rules ("All DB writes through `recordEvent`; no direct
 *     `estado` mutation elsewhere").
 *   - SPEC-0026 §6.3 (write a row in a transaction with the document
 *     update; reject illegal transitions).
 *   - TASKS-0020 §5.2.
 *
 * Contract:
 *   - Looks up the document by id inside the transaction.
 *   - Validates `canTransition(currentEstado, nextEstado)`. The idempotent
 *     self-loop (same estado) is allowed when the etapa indicates a poll
 *     refresh; downstream callers can opt into it via the `allowSelfLoop`
 *     flag.
 *   - Writes the new estado on `SriDocument` AND appends an `SriEvent`
 *     row in the SAME transaction so the two stay in lockstep.
 *   - Returns the updated document.
 *
 * Errors thrown:
 *   - `NotFoundError` when no document with that id exists.
 *   - `ConflictError(sri.invalid_transition)` when the transition is not
 *     allowed by the matrix.
 *   - `ConflictError(sri.transition_race)` when the WHERE clause guard
 *     ("estado = expected") fails — i.e. a concurrent writer beat us.
 */
import type { PrismaClient, Prisma, SriDocument, SriEstado, SriEtapa } from "@facturador/db";
import { ConflictError, NotFoundError } from "@facturador/utils/errors";
import type { SriMensaje } from "@facturador/contracts/errors";
import { ulid } from "ulid";
import { canTransition } from "./transitions.js";

/**
 * Either a fresh PrismaClient or an interactive transaction's `tx`
 * binding (which exposes the same model methods minus `$transaction`).
 * Accepting both lets callers nest the lifecycle write inside their
 * own outer transaction (used by the polling job, which holds rows
 * locked via `FOR UPDATE SKIP LOCKED` for the duration of the batch).
 */
export type PrismaClientOrTx =
  | PrismaClient
  | Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface RecordEventInput {
  readonly documentId: string;
  readonly etapa: SriEtapa;
  readonly estado: SriEstado;
  readonly mensajes?: readonly SriMensaje[];
  readonly durationMs?: number;
  /**
   * Allow `current.estado === input.estado` as a legitimate no-op transition
   * (e.g. the polling job re-confirming EN_PROCESO). Default false.
   */
  readonly allowSelfLoop?: boolean;
  /** Optional patch fields applied to the SriDocument in the same tx. */
  readonly patch?: Pick<
    Prisma.SriDocumentUncheckedUpdateInput,
    "numeroAutorizacion" | "fechaAutorizacion" | "signedXmlBlobKey" | "authorizedXmlBlobKey"
  >;
  /**
   * Override the id generator for tests. Defaults to `ulid()`.
   */
  readonly newId?: () => string;
}

export interface RecordEventResult {
  readonly document: SriDocument;
  readonly eventId: string;
}

export async function recordEvent(
  prisma: PrismaClientOrTx,
  input: RecordEventInput,
): Promise<RecordEventResult> {
  const eventId = (input.newId ?? ulid)();
  const durationMs = input.durationMs ?? 0;
  const mensajes = input.mensajes ?? [];

  // When the caller is already inside an interactive transaction
  // (`prisma.$transaction(async (tx) => ...)`), we cannot start a
  // nested transaction — Prisma's interactive tx interface omits
  // `$transaction` on `tx`. We detect that by feature-sniffing the
  // `$transaction` method; if absent we run the work directly against
  // the supplied client, which already holds row locks for the caller.
  const run = async (db: PrismaClientOrTx): Promise<RecordEventResult> => {
    const existing = await db.sriDocument.findUnique({
      where: { id: input.documentId },
    });
    if (existing === null) {
      throw new NotFoundError("sri_document");
    }

    const sameState = existing.estado === input.estado;
    if (sameState && input.allowSelfLoop !== true) {
      // Reject the no-op unless explicitly allowed. This protects callers
      // from accidentally generating a noisy event timeline.
      throw new ConflictError(
        `Invalid transition ${existing.estado} → ${input.estado} (self-loop disabled)`,
        "sri.invalid_transition",
      );
    }
    if (!sameState && !canTransition(existing.estado, input.estado)) {
      throw new ConflictError(
        `Invalid transition ${existing.estado} → ${input.estado}`,
        "sri.invalid_transition",
      );
    }

    // Guarded update: only succeeds if the row is still in the expected
    // `from` state. A concurrent writer that already advanced the state
    // will produce `count: 0` and we surface that as a 409.
    const updateResult = await db.sriDocument.updateMany({
      where: { id: input.documentId, estado: existing.estado },
      data: {
        estado: input.estado,
        ...(input.patch ?? {}),
        // `mensajesJson` is overwritten with the latest snapshot — the event
        // row preserves the history.
        mensajesJson: mensajes as unknown as Prisma.InputJsonValue,
      },
    });
    if (updateResult.count !== 1) {
      throw new ConflictError("Concurrent state mutation", "sri.transition_race");
    }

    await db.sriEvent.create({
      data: {
        id: eventId,
        documentId: input.documentId,
        etapa: input.etapa,
        estado: input.estado,
        durationMs,
        mensajesJson: mensajes as unknown as Prisma.InputJsonValue,
      },
    });

    const refreshed = await db.sriDocument.findUniqueOrThrow({
      where: { id: input.documentId },
    });
    return { document: refreshed, eventId };
  };

  // Feature-sniff: an interactive tx omits `$transaction`. If we're at
  // the top level (PrismaClient), wrap the work in a fresh transaction
  // so the find/updateMany/create stay atomic. Otherwise reuse the
  // caller's tx so we don't break their lock guarantees.
  const maybeTransactional = (prisma as Partial<PrismaClient>).$transaction;
  if (typeof maybeTransactional === "function") {
    return (prisma as PrismaClient).$transaction(async (tx) => run(tx));
  }
  return run(prisma);
}
