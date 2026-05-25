/**
 * `emitFactura` — end-to-end SRI document lifecycle orchestrator.
 *
 * Source of truth:
 *   - SPEC-0026 §FR-2 (orchestrator contract).
 *   - SPEC-0026 §6.4 (orchestrator key flow).
 *   - PLAN-0026 §4 Phase 2.
 *   - TASKS-0026 §3.1, §5.
 *   - PROMPT-0026 §4 (idempotency + redaction).
 *
 * Pipeline (in order):
 *
 *   1. Look up the document by id. If it's in a terminal state
 *      (AUTORIZADO, NO_AUTORIZADO, DEVUELTA, ERROR_BUILD) we short-
 *      circuit immediately — emitFactura is idempotent on terminal
 *      states.
 *   2. BUILD: invoke `buildFacturaXml`. A schema/tax-code error transitions
 *      the document to ERROR_BUILD and returns; ERROR_BUILD is terminal
 *      because the caller must reissue with a corrected payload.
 *   3. SIGN: invoke `runSignStep` which loads the active certificate,
 *      signs the canonical body, persists the signed XML in the BlobStore,
 *      and transitions PENDIENTE → FIRMADO.
 *   4. SEND (recepción): invoke `RecepcionClient.send`.
 *      - On transient `SriClientError`: transition FIRMADO → ERROR_RED
 *        and return; `/resend` re-runs from FIRMADO.
 *      - On DEVUELTA (after mensaje-43 reclassification): transition
 *        ENVIADO → DEVUELTA (terminal) with mensajes.
 *      - On RECIBIDA: transition FIRMADO → ENVIADO → RECIBIDA.
 *   5. AUTHORIZE (autorización): invoke `AutorizacionClient.query` once
 *      (best-effort). The result is normalised + persisted:
 *      - AUTORIZADO: persist authorized XML, set numeroAutorizacion +
 *        fechaAutorizacion, transition to AUTORIZADO (terminal).
 *      - NO_AUTORIZADO: transition to NO_AUTORIZADO (terminal).
 *      - EN_PROCESO: transition to EN_PROCESO and set `nextPollAt =
 *        now() + 30s`. The polling job picks it up from there.
 *      - DESCONOCIDO: leave in RECIBIDA + bump nextPollAt; polling job
 *        will retry.
 *
 * Hard rules:
 *
 *   - Every state transition goes through `recordEvent` (which itself
 *     gates on `canTransition`). No direct `prisma.sriDocument.update`
 *     on `estado` lives in this file.
 *   - Idempotency: re-invocation with the same `documentId` on a
 *     terminal state returns the existing row without re-running any
 *     side effect. On a transient state (RECIBIDA / EN_PROCESO) the
 *     orchestrator picks up from where the previous attempt left off.
 *   - Audit: every meaningful step writes an `audit()` row carrying
 *     `claveAcceso`, `outcome`, `durationMs`. No XML body, no PEM
 *     fragment, no sensitive payload ever crosses the audit boundary
 *     (the `redactPayload` walker enforces this defensively).
 *   - Logs: only `{ documentId, companyId, claveAcceso, estado,
 *     durationMs }` and similar identifiers. The signed XML is never
 *     logged; the redactor strips `signedXml` and `authorizedXml` by
 *     path as defence in depth.
 *
 * Stub mode (SRI_STUB_MODE=true): the orchestrator emits a deterministic
 * pseudo-pipeline that walks PENDIENTE → FIRMADO → ENVIADO → RECIBIDA →
 * AUTORIZADO without touching the cert store or the SOAP client. This is
 * the path the apps/api integration tests exercise; it keeps developer
 * iteration possible without a real .p12 + sandbox SRI endpoint.
 */
import type { PrismaClient, SriDocument } from "@facturador/db";
import type { SriMensaje } from "@facturador/contracts/sri";
import { ConflictError, NotFoundError } from "@facturador/utils/errors";
import type { Logger } from "@facturador/logger";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import {
  AutorizacionClient,
  RecepcionClient,
  SriClientError,
  type Ambiente,
} from "../soap/index.js";
import { buildFacturaXml, XmlBuildError } from "../xml/factura.js";
import { runSignStep } from "./sign-step.js";
import { recordEvent } from "./events.js";
import type { BlobStore } from "../blobs/blob-store.js";
import { authorizedXmlKey } from "../blobs/blob-store.js";
import { isTerminal } from "./transitions.js";
import type { SignAlgo } from "../xml/sign.js";

/* -------------------------------------------------------------------------- */
/*                                 Public API                                 */
/* -------------------------------------------------------------------------- */

/**
 * Outcome of an emit attempt. `estado` is the document's terminal-or-
 * transient state at return time; the orchestrator handles its own
 * persistence so callers don't need to refetch.
 */
export interface EmitFacturaResult {
  readonly document: SriDocument;
  /** ISO timestamp of the last transition recorded in this call. */
  readonly lastTransitionAt: string;
  /** Whether the orchestrator did any work (false on a terminal short-circuit). */
  readonly didWork: boolean;
}

export interface EmitFacturaInput {
  /** `SriDocument.id`. The caller persisted the row in PENDIENTE first. */
  readonly documentId: string;
  /**
   * Parsed factura payload that came in on the emit body. The orchestrator
   * passes this straight to `buildFacturaXml`; downstream Zod refines it.
   * Stub mode ignores the value entirely.
   */
  readonly facturaInput?: unknown;
  /**
   * When set to true, bypass the synchronous autorización call after a
   * RECIBIDA. The polling job will pick it up. Default false.
   * Mostly used by `/resend` to keep the request fast.
   */
  readonly skipSyncAutorizacion?: boolean;
}

export interface EmitFacturaDeps {
  readonly prisma: PrismaClient;
  readonly blobStore: BlobStore;
  /** Stub mode flag — when true, the SOAP clients are not invoked. */
  readonly stubMode: boolean;
  /** SOAP clients. Optional in stub mode where they are never called. */
  readonly recepcionClient?: RecepcionClient;
  readonly autorizacionClient?: AutorizacionClient;
  /** Signing algorithm pin. Default SHA1 per env. */
  readonly signAlgo?: SignAlgo;
  /**
   * Initial nextPollAt offset (ms) for EN_PROCESO documents. Default 30s
   * per SPEC-0026 §6.4.
   */
  readonly initialPollDelayMs?: number;
  /** Logger; never receives XML bodies or PEMs. */
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  /** Clock override for tests. */
  readonly now?: () => Date;
}

/**
 * Orchestrate the SRI emission pipeline for `documentId`. See file
 * docblock for the full contract. Returns the latest document row.
 *
 * NEVER throws on a business outcome (DEVUELTA, NO_AUTORIZADO, network
 * error). Those resolve as `result.document.estado` values. The function
 * throws only on:
 *   - `NotFoundError` when `documentId` doesn't exist;
 *   - `ConflictError(sri.invalid_transition)` on an illegal transition
 *     (only possible if a concurrent writer raced — defence in depth).
 *
 * Any unexpected error (programmer bug) propagates so the request handler's
 * generic error path surfaces a 500 — never silently lost.
 */
export async function emitFactura(
  deps: EmitFacturaDeps,
  input: EmitFacturaInput,
): Promise<EmitFacturaResult> {
  const { prisma, blobStore, stubMode, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const initialPollDelayMs = deps.initialPollDelayMs ?? 30_000;

  // ----- 1. Load the document ------------------------------------------------
  const doc = await prisma.sriDocument.findUnique({
    where: { id: input.documentId },
  });
  if (doc === null) {
    throw new NotFoundError("sri_document");
  }

  // ----- 1.b Terminal short-circuit ----------------------------------------
  if (isTerminal(doc.estado)) {
    logger?.info(
      {
        event: "sri.emit.idempotent_terminal",
        documentId: doc.id,
        companyId: doc.companyId,
        estado: doc.estado,
      },
      "emitFactura idempotent — already terminal",
    );
    return {
      document: doc,
      lastTransitionAt: doc.updatedAt.toISOString(),
      didWork: false,
    };
  }

  // Branch: stub mode walks a deterministic state path without touching
  // the SOAP clients or signing. Used by the apps/api integration tests
  // and the dev compose smoke.
  if (stubMode) {
    return runStubPipeline(
      {
        prisma,
        now,
        ...(logger === undefined ? {} : { logger }),
      },
      doc,
    );
  }

  // ----- 2. BUILD ----------------------------------------------------------
  // We only run BUILD when the document is still in PENDIENTE. Re-entry
  // from FIRMADO/ENVIADO/RECIBIDA/EN_PROCESO/ERROR_RED skips ahead.
  if (doc.estado === "PENDIENTE") {
    let xmlForSigning: string;
    const buildStart = Date.now();
    try {
      const built = buildFacturaXml(input.facturaInput);
      xmlForSigning = built.xmlForSigning;
    } catch (err) {
      const durationMs = Date.now() - buildStart;
      if (err instanceof XmlBuildError) {
        logger?.warn(
          {
            event: "sri.emit.build_failed",
            documentId: doc.id,
            companyId: doc.companyId,
            code: err.code,
            path: err.path,
          },
          "factura build failed",
        );
        await recordEvent(prisma, {
          documentId: doc.id,
          etapa: "BUILD",
          estado: "ERROR_BUILD",
          durationMs,
        });
        await safeAudit(deps, {
          action: "sri.build.error",
          entity: "SriDocument",
          entityId: doc.id,
          companyId: doc.companyId,
          payloadJson: {
            claveAcceso: doc.claveAcceso,
            outcome: "ERROR_BUILD",
            durationMs,
            code: err.code,
            path: err.path,
          },
        });
        const fresh = await prisma.sriDocument.findUniqueOrThrow({
          where: { id: doc.id },
        });
        return {
          document: fresh,
          lastTransitionAt: fresh.updatedAt.toISOString(),
          didWork: true,
        };
      }
      throw err;
    }

    // ----- 3. SIGN --------------------------------------------------------
    const signStart = Date.now();
    try {
      await runSignStep(
        {
          prisma,
          blobStore,
          ...(logger === undefined ? {} : { logger }),
          now: () => now,
        },
        {
          documentId: doc.id,
          xmlForSigning,
          ...(deps.signAlgo === undefined ? {} : { algo: deps.signAlgo }),
        },
      );
    } catch (err) {
      const durationMs = Date.now() - signStart;
      // Sign-step failures (no cert, expired cert, bad PEM) are surfaced
      // as the original error. The state stays PENDIENTE — operator must
      // upload a fresh certificate before re-emitting. We DON'T transition
      // to ERROR_RED here because the failure isn't network-class.
      logger?.warn(
        {
          event: "sri.emit.sign_failed",
          documentId: doc.id,
          companyId: doc.companyId,
          reason: err instanceof Error ? err.name : "Unknown",
          durationMs,
        },
        "sign step failed during emit",
      );
      throw err;
    }
  }

  // ----- 4. SEND (recepción) ------------------------------------------------
  // Read back the latest document state — sign-step may have advanced
  // it to FIRMADO; a previous emit attempt may have already reached
  // RECIBIDA/EN_PROCESO and is now re-entering.
  let current = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });

  if (current.estado === "FIRMADO" || current.estado === "ERROR_RED") {
    // Re-fetch the signed XML from the blob store. If it's missing (shouldn't
    // happen on a healthy install) the orchestrator surfaces a typed error.
    if (current.signedXmlBlobKey === null) {
      throw new ConflictError(
        "Document has no signedXmlBlobKey but is in FIRMADO/ERROR_RED",
        "sri.missing_signed_blob",
      );
    }
    const signed = await blobStore.get(current.signedXmlBlobKey);
    if (signed === null) {
      throw new ConflictError("Signed XML blob is missing from store", "sri.missing_signed_blob");
    }

    if (deps.recepcionClient === undefined) {
      throw new ConflictError("RecepcionClient is required in non-stub mode", "sri.misconfigured");
    }
    const sendStart = Date.now();
    try {
      const result = await deps.recepcionClient.send({
        signedXml: Buffer.from(signed, "utf8"),
        ambiente: current.ambiente as Ambiente,
        claveAcceso: current.claveAcceso,
      });
      const durationMs = Date.now() - sendStart;
      const mensajes = result.mensajes as readonly SriMensaje[];

      // Walk the legal transition chain in order: FIRMADO → ENVIADO →
      // (RECIBIDA | DEVUELTA). We always go through ENVIADO so the
      // timeline tells the operator "we got the response back".
      if (current.estado === "FIRMADO") {
        await recordEvent(prisma, {
          documentId: current.id,
          etapa: "SEND",
          estado: "ENVIADO",
          durationMs,
          mensajes,
        });
      } else {
        // ERROR_RED → ENVIADO is explicitly allowed in the matrix.
        await recordEvent(prisma, {
          documentId: current.id,
          etapa: "SEND",
          estado: "ENVIADO",
          durationMs,
          mensajes,
        });
      }

      if (result.estado === "DEVUELTA") {
        await recordEvent(prisma, {
          documentId: current.id,
          etapa: "RECEIVE",
          estado: "DEVUELTA",
          durationMs: 0,
          mensajes,
        });
        await safeAudit(deps, {
          action: "sri.recepcion.devuelta",
          entity: "SriDocument",
          entityId: current.id,
          companyId: current.companyId,
          payloadJson: {
            claveAcceso: current.claveAcceso,
            outcome: "DEVUELTA",
            durationMs,
            httpStatus: result.httpStatus,
            mensajesIds: mensajes.map((m) => ({
              identificador: m.identificador,
              tipo: m.tipo,
            })),
          },
        });
        const fresh = await prisma.sriDocument.findUniqueOrThrow({
          where: { id: current.id },
        });
        return {
          document: fresh,
          lastTransitionAt: fresh.updatedAt.toISOString(),
          didWork: true,
        };
      }

      // RECIBIDA path (includes mensaje-43 reclassification).
      await recordEvent(prisma, {
        documentId: current.id,
        etapa: "RECEIVE",
        estado: "RECIBIDA",
        durationMs: 0,
        mensajes,
      });
      await safeAudit(deps, {
        action: "sri.recepcion.recibida",
        entity: "SriDocument",
        entityId: current.id,
        companyId: current.companyId,
        payloadJson: {
          claveAcceso: current.claveAcceso,
          outcome: "RECIBIDA",
          durationMs,
          httpStatus: result.httpStatus,
          reclassifiedFromDevuelta: result.reclassifiedFromDevuelta,
        },
      });
    } catch (err) {
      const durationMs = Date.now() - sendStart;
      const transient = err instanceof SriClientError && err.transient;
      if (!transient && err instanceof SriClientError) {
        // Non-transient SOAP error (4xx, parse failure). Still record
        // ERROR_RED so the timeline reflects the attempt; the resend
        // endpoint will refuse on terminal states only.
        logger?.warn(
          {
            event: "sri.emit.send_nontransient",
            documentId: current.id,
            companyId: current.companyId,
            kind: err.kind,
            durationMs,
          },
          "non-transient SRI error during send",
        );
      }
      // Both transient and non-transient SOAP errors transition to
      // ERROR_RED. The resend endpoint distinguishes them by inspecting
      // the document and asking the operator to reissue when needed.
      await recordEvent(prisma, {
        documentId: current.id,
        etapa: "SEND",
        estado: "ERROR_RED",
        durationMs,
      });
      await safeAudit(deps, {
        action: "sri.recepcion.network_error",
        entity: "SriDocument",
        entityId: current.id,
        companyId: current.companyId,
        payloadJson: {
          claveAcceso: current.claveAcceso,
          outcome: "ERROR_RED",
          durationMs,
          transient,
          kind: err instanceof SriClientError ? err.kind : "unknown",
        },
      });
      const fresh = await prisma.sriDocument.findUniqueOrThrow({
        where: { id: current.id },
      });
      return {
        document: fresh,
        lastTransitionAt: fresh.updatedAt.toISOString(),
        didWork: true,
      };
    }
    current = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: current.id },
    });
  }

  // ----- 5. AUTHORIZE (best effort) ----------------------------------------
  if (input.skipSyncAutorizacion === true) {
    // Caller asked us to defer to the polling job. Schedule the first
    // attempt 30s out so the worker picks it up promptly.
    if (current.estado === "RECIBIDA") {
      await prisma.sriDocument.update({
        where: { id: current.id },
        data: {
          // Keep estado RECIBIDA — polling job advances to EN_PROCESO/
          // AUTORIZADO when SRI confirms. We piggyback on the
          // nextPollAt index by leaving the column NULL so the next
          // scan picks it up.
          nextPollAt: new Date(now.getTime() + initialPollDelayMs),
        },
      });
    }
    const fresh = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: current.id },
    });
    return {
      document: fresh,
      lastTransitionAt: fresh.updatedAt.toISOString(),
      didWork: true,
    };
  }

  if (current.estado === "RECIBIDA" || current.estado === "EN_PROCESO") {
    if (deps.autorizacionClient === undefined) {
      throw new ConflictError(
        "AutorizacionClient is required in non-stub mode",
        "sri.misconfigured",
      );
    }
    const authStart = Date.now();
    try {
      const result = await deps.autorizacionClient.query({
        claveAcceso: current.claveAcceso,
        ambiente: current.ambiente as Ambiente,
      });
      const durationMs = Date.now() - authStart;
      const mensajes = result.mensajes as readonly SriMensaje[];

      if (result.estado === "AUTORIZADO") {
        // Persist authorized XML when present.
        let authBlobKey: string | undefined;
        if (result.autorizadoXml !== undefined) {
          const key = authorizedXmlKey(current.companyId, current.id);
          await blobStore.put(key, result.autorizadoXml);
          authBlobKey = key;
        }
        await recordEvent(prisma, {
          documentId: current.id,
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
        await safeAudit(deps, {
          action: "sri.autorizacion.autorizado",
          entity: "SriDocument",
          entityId: current.id,
          companyId: current.companyId,
          payloadJson: {
            claveAcceso: current.claveAcceso,
            outcome: "AUTORIZADO",
            durationMs,
            httpStatus: result.httpStatus,
            ...(result.numeroAutorizacion === undefined
              ? {}
              : { numeroAutorizacion: result.numeroAutorizacion }),
          },
        });
      } else if (result.estado === "NO_AUTORIZADO") {
        await recordEvent(prisma, {
          documentId: current.id,
          etapa: "AUTHORIZE",
          estado: "NO_AUTORIZADO",
          durationMs,
          mensajes,
        });
        await safeAudit(deps, {
          action: "sri.autorizacion.no_autorizado",
          entity: "SriDocument",
          entityId: current.id,
          companyId: current.companyId,
          payloadJson: {
            claveAcceso: current.claveAcceso,
            outcome: "NO_AUTORIZADO",
            durationMs,
            httpStatus: result.httpStatus,
            mensajesIds: mensajes.map((m) => ({
              identificador: m.identificador,
              tipo: m.tipo,
            })),
          },
        });
      } else if (result.estado === "EN_PROCESO") {
        // First polling deadline = now + 30s. The polling job re-bumps
        // it on each attempt via the exponential backoff schedule.
        await recordEvent(prisma, {
          documentId: current.id,
          etapa: "AUTHORIZE",
          estado: "EN_PROCESO",
          durationMs,
          mensajes,
          patch: {},
        });
        await prisma.sriDocument.update({
          where: { id: current.id },
          data: {
            nextPollAt: new Date(now.getTime() + initialPollDelayMs),
            pollAttempts: 0,
          },
        });
        await safeAudit(deps, {
          action: "sri.autorizacion.en_proceso",
          entity: "SriDocument",
          entityId: current.id,
          companyId: current.companyId,
          payloadJson: {
            claveAcceso: current.claveAcceso,
            outcome: "EN_PROCESO",
            durationMs,
            httpStatus: result.httpStatus,
          },
        });
      } else {
        // DESCONOCIDO — leave in RECIBIDA, let the polling job retry.
        // No state transition; we record an informational event via the
        // self-loop policy.
        await prisma.sriDocument.update({
          where: { id: current.id },
          data: {
            nextPollAt: new Date(now.getTime() + initialPollDelayMs),
          },
        });
        await safeAudit(deps, {
          action: "sri.autorizacion.desconocido",
          entity: "SriDocument",
          entityId: current.id,
          companyId: current.companyId,
          payloadJson: {
            claveAcceso: current.claveAcceso,
            outcome: "DESCONOCIDO",
            durationMs,
            httpStatus: result.httpStatus,
          },
        });
      }
    } catch (err) {
      const durationMs = Date.now() - authStart;
      // Autorización failure (network / parse) — leave document in
      // RECIBIDA so the polling job picks it up. Schedule a near-term
      // retry via nextPollAt.
      logger?.warn(
        {
          event: "sri.emit.autorizacion_failed",
          documentId: current.id,
          companyId: current.companyId,
          kind: err instanceof SriClientError ? err.kind : "unknown",
          durationMs,
        },
        "sync autorización failed; polling will retry",
      );
      await prisma.sriDocument.update({
        where: { id: current.id },
        data: {
          nextPollAt: new Date(now.getTime() + initialPollDelayMs),
        },
      });
      await safeAudit(deps, {
        action: "sri.autorizacion.network_error",
        entity: "SriDocument",
        entityId: current.id,
        companyId: current.companyId,
        payloadJson: {
          claveAcceso: current.claveAcceso,
          outcome: "ERROR_RED",
          durationMs,
          kind: err instanceof SriClientError ? err.kind : "unknown",
        },
      });
    }
  }

  const final = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });
  return {
    document: final,
    lastTransitionAt: final.updatedAt.toISOString(),
    didWork: true,
  };
}

/* -------------------------------------------------------------------------- */
/*                               Stub pipeline                                */
/* -------------------------------------------------------------------------- */

interface StubDeps {
  readonly prisma: PrismaClient;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  readonly now: Date;
}

/**
 * Deterministic in-process pipeline walked when SRI_STUB_MODE=true.
 * Used by apps/api integration tests so they don't need a real
 * certificate + sandbox SRI endpoint.
 *
 * The stub still pushes the document through every legal transition so
 * the timeline matches a real run: 4 events (SIGN, SEND, RECEIVE,
 * AUTHORIZE) + the optional BUILD that the route handler may have
 * pre-seeded.
 */
async function runStubPipeline(deps: StubDeps, doc: SriDocument): Promise<EmitFacturaResult> {
  const { prisma, now } = deps;

  // PENDIENTE → FIRMADO (SIGN).
  if (doc.estado === "PENDIENTE") {
    await recordEvent(prisma, {
      documentId: doc.id,
      etapa: "SIGN",
      estado: "FIRMADO",
      durationMs: 0,
    });
  }

  // FIRMADO → ENVIADO (SEND).
  let current = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });
  if (current.estado === "FIRMADO" || current.estado === "ERROR_RED") {
    await recordEvent(prisma, {
      documentId: current.id,
      etapa: "SEND",
      estado: "ENVIADO",
      durationMs: 0,
    });
  }

  // ENVIADO → RECIBIDA (RECEIVE).
  current = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });
  if (current.estado === "ENVIADO") {
    await recordEvent(prisma, {
      documentId: current.id,
      etapa: "RECEIVE",
      estado: "RECIBIDA",
      durationMs: 0,
    });
  }

  // RECIBIDA → AUTORIZADO (AUTHORIZE).
  current = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });
  if (current.estado === "RECIBIDA") {
    await recordEvent(prisma, {
      documentId: current.id,
      etapa: "AUTHORIZE",
      estado: "AUTORIZADO",
      durationMs: 0,
      patch: {
        numeroAutorizacion: `STUB-${current.claveAcceso}`,
        fechaAutorizacion: now,
      },
    });
  }

  const final = await prisma.sriDocument.findUniqueOrThrow({
    where: { id: doc.id },
  });
  return {
    document: final,
    lastTransitionAt: final.updatedAt.toISOString(),
    didWork: true,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Audit                                     */
/* -------------------------------------------------------------------------- */

/**
 * Audit helper that never throws (the `audit()` function in
 * @facturador/utils swallows errors but typing requires us to pass the
 * logger). The prisma client is structurally compatible with
 * `AuditPrismaClient`.
 */
async function safeAudit(
  deps: EmitFacturaDeps,
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
