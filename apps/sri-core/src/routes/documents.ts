/**
 * `/v1/documents/*` routes — SPEC-0020 §6.5 + SPEC-0026 surface consumed
 * by `apps/api`.
 *
 *   POST /v1/documents/emit
 *   GET  /v1/documents/:claveAcceso/status
 *   POST /v1/documents/:claveAcceso/resend
 *
 * Every route requires a valid service JWT (mounted in the app factory).
 * Inside each handler we also re-check `body.companyId === req.service.companyId`
 * because the JWT `sub` is the only trustworthy tenant scope.
 *
 * Behaviour (SPEC-0026 wiring):
 *   - `emit` persists a SriDocument in PENDIENTE inside the same
 *     transaction as the initial BUILD event row, then hands off to
 *     `emitFactura(deps, { documentId, facturaInput })`. The orchestrator
 *     drives the full BUILD → SIGN → SEND → AUTHORIZE pipeline.
 *   - Idempotency: a second emit for the same `claveAcceso` re-enters the
 *     orchestrator with the existing documentId. The orchestrator
 *     short-circuits on terminal states (AUTORIZADO / NO_AUTORIZADO /
 *     DEVUELTA / ERROR_BUILD) so the second call is a no-op.
 *   - `resend` is now implemented:
 *       - Terminal "reissue-required" states (NO_AUTORIZADO, DEVUELTA,
 *         ERROR_BUILD) → 422 + `code:"reissue_required"`.
 *       - AUTORIZADO → 200 with the current document (no-op).
 *       - PENDIENTE / FIRMADO / ENVIADO / RECIBIDA / EN_PROCESO /
 *         ERROR_RED → re-enter `emitFactura` to resume from where the
 *         previous attempt stopped.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { ClaveAccesoSchema } from "@facturador/contracts/primitives";
import {
  EmitDocumentRequestSchema,
  type EmitDocumentResponse,
  type DocumentStatusResponse,
} from "@facturador/contracts/sri";
import type { PrismaClient, SriEstado } from "@facturador/db";
import { newId } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { BusinessError, ForbiddenError, NotFoundError } from "@facturador/utils/errors";

import type { BlobStore } from "../blobs/blob-store.js";
import { emitFactura, type EmitFacturaDeps } from "../lifecycle/emit-factura.js";
import { REISSUE_REQUIRED_ESTADOS, isTerminal } from "../lifecycle/transitions.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import type { AutorizacionClient, RecepcionClient } from "../soap/index.js";

export interface BuildDocumentsRouterDeps {
  readonly prisma: PrismaClient;
  /** Whether stub mode is enabled (env.SRI_STUB_MODE). */
  readonly stubMode: boolean;
  /** BlobStore used for signed + authorized XML persistence. */
  readonly blobStore: BlobStore;
  /** Optional SOAP clients (required in non-stub mode). */
  readonly recepcionClient?: RecepcionClient;
  readonly autorizacionClient?: AutorizacionClient;
  readonly logger?: Logger;
}

const ClaveAccesoParamsSchema = z.object({
  claveAcceso: ClaveAccesoSchema,
});

/**
 * Convert a Prisma SriDocument row + (optionally) its event rows into the
 * wire shape used by the contracts package. We hand-format dates as
 * ISO-8601 strings because the contract schema treats them that way.
 */
function toEmitResponse(doc: {
  claveAcceso: string;
  estado: SriEstado;
  numeroAutorizacion: string | null;
  fechaAutorizacion: Date | null;
}): EmitDocumentResponse {
  return {
    claveAcceso: doc.claveAcceso as EmitDocumentResponse["claveAcceso"],
    estado: doc.estado,
    ...(doc.numeroAutorizacion === null ? {} : { numeroAutorizacion: doc.numeroAutorizacion }),
    ...(doc.fechaAutorizacion === null
      ? {}
      : { fechaAutorizacion: doc.fechaAutorizacion.toISOString() }),
  };
}

function toStatusResponse(
  doc: {
    id: string;
    companyId: string;
    claveAcceso: string;
    ambiente: string;
    tipoComprobante: string;
    estab: string;
    ptoEmi: string;
    secuencial: string;
    fechaEmision: Date;
    estado: SriEstado;
    numeroAutorizacion: string | null;
    fechaAutorizacion: Date | null;
    signedXmlBlobKey: string | null;
    authorizedXmlBlobKey: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  events: readonly {
    id: string;
    documentId: string;
    etapa: string;
    estado: SriEstado;
    mensajesJson: unknown;
    durationMs: number;
    createdAt: Date;
  }[],
): DocumentStatusResponse {
  return {
    document: {
      id: doc.id as DocumentStatusResponse["document"]["id"],
      companyId: doc.companyId as DocumentStatusResponse["document"]["companyId"],
      claveAcceso: doc.claveAcceso as DocumentStatusResponse["document"]["claveAcceso"],
      ambiente: doc.ambiente as DocumentStatusResponse["document"]["ambiente"],
      codDoc: doc.tipoComprobante as DocumentStatusResponse["document"]["codDoc"],
      estab: doc.estab as DocumentStatusResponse["document"]["estab"],
      ptoEmi: doc.ptoEmi as DocumentStatusResponse["document"]["ptoEmi"],
      secuencial: doc.secuencial as DocumentStatusResponse["document"]["secuencial"],
      // The contract uses `dd/mm/aaaa` for the IsoDate primitive; the
      // glossary keeps the same format. We render directly from the Date.
      fechaEmision: formatFechaEmision(doc.fechaEmision),
      estado: doc.estado,
      ...(doc.numeroAutorizacion === null ? {} : { numeroAutorizacion: doc.numeroAutorizacion }),
      ...(doc.fechaAutorizacion === null
        ? {}
        : { fechaAutorizacion: doc.fechaAutorizacion.toISOString() }),
      ...(doc.signedXmlBlobKey === null ? {} : { signedXmlBlobId: doc.signedXmlBlobKey }),
      ...(doc.authorizedXmlBlobKey === null
        ? {}
        : { authorizedXmlBlobId: doc.authorizedXmlBlobKey }),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    },
    events: events.map((e) => ({
      // The contracts SriEvent is a discriminated union — building each
      // variant explicitly keeps the type narrowing sound.
      id: e.id as DocumentStatusResponse["events"][number]["id"],
      documentId: e.documentId as DocumentStatusResponse["events"][number]["documentId"],
      etapa: e.etapa as DocumentStatusResponse["events"][number]["etapa"],
      estado: e.estado,
      // Defensive: `mensajesJson` is non-null per the Prisma schema but old
      // rows in production may have null literals.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      mensajes: (e.mensajesJson as DocumentStatusResponse["events"][number]["mensajes"]) ?? [],
      durationMs: e.durationMs,
      createdAt: e.createdAt.toISOString(),
    })) as DocumentStatusResponse["events"],
  };
}

function formatFechaEmision(d: Date): DocumentStatusResponse["document"]["fechaEmision"] {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const aaaa = String(d.getUTCFullYear());
  return `${dd}/${mm}/${aaaa}` as DocumentStatusResponse["document"]["fechaEmision"];
}

function parseFechaEmision(value: string): Date {
  // `dd/mm/aaaa` per the contract — already validated by Zod upstream.
  const [dd, mm, aaaa] = value.split("/");
  return new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(dd)));
}

export function buildDocumentsRouter(deps: BuildDocumentsRouterDeps): Router {
  const router = Router();
  const { prisma, stubMode, blobStore, logger } = deps;

  // Assemble the orchestrator deps once. We construct on each call to
  // avoid stale references after a deps swap in tests.
  const buildOrchestratorDeps = (): EmitFacturaDeps => ({
    prisma,
    blobStore,
    stubMode,
    ...(deps.recepcionClient === undefined ? {} : { recepcionClient: deps.recepcionClient }),
    ...(deps.autorizacionClient === undefined
      ? {}
      : { autorizacionClient: deps.autorizacionClient }),
    ...(logger === undefined ? {} : { logger }),
  });

  router.post(
    "/emit",
    validateBody(EmitDocumentRequestSchema),
    async (req: Request, res: Response<EmitDocumentResponse>) => {
      const body = req.body as Record<string, unknown> & {
        companyId: string;
        ambiente: string;
        codDoc: string;
        estab: string;
        ptoEmi: string;
        secuencial: string;
        claveAcceso: string;
        fechaEmision: string;
        factura?: unknown;
      };
      const callerCompanyId = req.service?.companyId;
      if (callerCompanyId === undefined) {
        // Should be impossible: requireServiceJwt runs before this handler.
        throw new ForbiddenError("Service token missing");
      }
      if (body.companyId !== callerCompanyId) {
        throw new ForbiddenError(
          "companyId in body does not match service token sub",
          "tenant.forbidden",
        );
      }

      const existing = await prisma.sriDocument.findUnique({
        where: { claveAcceso: body.claveAcceso },
      });

      // Branch 1: pre-existing row. Cross-tenant attempts are 403;
      // same-tenant re-emits run through the orchestrator which is
      // idempotent on terminal states.
      if (existing !== null) {
        if (existing.companyId !== callerCompanyId) {
          throw new ForbiddenError("claveAcceso belongs to a different tenant", "tenant.forbidden");
        }
        const result = await emitFactura(buildOrchestratorDeps(), {
          documentId: existing.id,
          facturaInput: body.factura,
        });
        res.json(toEmitResponse(result.document));
        return;
      }

      // Branch 2: first emit. Insert PENDIENTE + initial BUILD event in
      // a single transaction so the timeline is never empty even if the
      // orchestrator throws before its first event.
      const docId = newId();
      const startingEventId = newId();
      const created = await prisma.$transaction(async (tx) => {
        const doc = await tx.sriDocument.create({
          data: {
            id: docId,
            companyId: callerCompanyId,
            tipoComprobante: body.codDoc,
            claveAcceso: body.claveAcceso,
            ambiente: body.ambiente,
            estab: body.estab,
            ptoEmi: body.ptoEmi,
            secuencial: body.secuencial,
            fechaEmision: parseFechaEmision(body.fechaEmision),
            estado: "PENDIENTE",
          },
        });
        await tx.sriEvent.create({
          data: {
            id: startingEventId,
            documentId: doc.id,
            etapa: "BUILD",
            estado: "PENDIENTE",
            durationMs: 0,
          },
        });
        return doc;
      });

      req.log?.info(
        {
          event: "sri.emit.persisted",
          companyId: callerCompanyId,
          documentId: docId,
          estado: "PENDIENTE",
        },
        "sri document persisted",
      );

      const result = await emitFactura(buildOrchestratorDeps(), {
        documentId: created.id,
        facturaInput: body.factura,
      });
      res.json(toEmitResponse(result.document));
    },
  );

  router.get(
    "/:claveAcceso/status",
    validateParams(ClaveAccesoParamsSchema),
    async (req: Request, res: Response<DocumentStatusResponse>) => {
      const callerCompanyId = req.service?.companyId;
      if (callerCompanyId === undefined) {
        throw new ForbiddenError("Service token missing");
      }
      const { claveAcceso } = req.params as unknown as { claveAcceso: string };
      const doc = await prisma.sriDocument.findFirst({
        where: { claveAcceso, companyId: callerCompanyId },
        include: {
          events: { orderBy: { createdAt: "asc" } },
        },
      });
      if (doc === null) {
        throw new NotFoundError("sri_document");
      }
      const { events, ...rest } = doc;
      res.json(toStatusResponse(rest, events));
    },
  );

  router.post(
    "/:claveAcceso/resend",
    validateParams(ClaveAccesoParamsSchema),
    async (req: Request, res: Response<EmitDocumentResponse>) => {
      const callerCompanyId = req.service?.companyId;
      if (callerCompanyId === undefined) {
        throw new ForbiddenError("Service token missing");
      }
      const { claveAcceso } = req.params as unknown as { claveAcceso: string };
      const doc = await prisma.sriDocument.findFirst({
        where: { claveAcceso, companyId: callerCompanyId },
      });
      if (doc === null) {
        throw new NotFoundError("sri_document");
      }

      // Reissue refusal: NO_AUTORIZADO / DEVUELTA / ERROR_BUILD demand
      // a fresh claveAcceso. Per PROMPT-0026 §5 we return a 422 with
      // `code:"reissue_required"`.
      if (REISSUE_REQUIRED_ESTADOS.includes(doc.estado)) {
        throw new BusinessError(
          `Document in ${doc.estado} cannot be resent; caller must reissue with a new claveAcceso`,
          "reissue_required",
        );
      }

      // AUTORIZADO is terminal but doesn't require reissue — return the
      // current state idempotently.
      if (isTerminal(doc.estado)) {
        res.json(toEmitResponse(doc));
        return;
      }

      // Transient states: re-enter the orchestrator. It picks up from
      // FIRMADO / ENVIADO / RECIBIDA / EN_PROCESO / ERROR_RED via the
      // state-machine rules.
      const result = await emitFactura(buildOrchestratorDeps(), {
        documentId: doc.id,
      });
      res.json(toEmitResponse(result.document));
    },
  );

  // ---------- Manual retry-polling for stuck EN_PROCESO documents ------
  // Audit punchlist Item 13 (REVIEW-0026 §8): the polling job caps at 60
  // attempts (~2 hours) before leaving an EN_PROCESO row untouched.
  // Operators / UI need an affordance to reset pollAttempts + nextPollAt
  // so the scheduler picks the row up again on its next tick. Service-
  // JWT gated (the mount in server.ts ensures that).
  router.post(
    "/:claveAcceso/retry-polling",
    validateParams(ClaveAccesoParamsSchema),
    async (req: Request, res: Response) => {
      const callerCompanyId = req.service?.companyId;
      if (callerCompanyId === undefined) {
        throw new ForbiddenError("Service token missing");
      }
      const { claveAcceso } = req.params as unknown as { claveAcceso: string };
      const doc = await prisma.sriDocument.findFirst({
        where: { claveAcceso, companyId: callerCompanyId },
      });
      if (doc === null) {
        throw new NotFoundError("sri_document");
      }
      // Only meaningful for EN_PROCESO documents — the polling job
      // only inspects rows in that state. For other states the reset
      // is a no-op; refuse with a 422 so the caller doesn't silently
      // "succeed" while leaving the document unchanged.
      if (doc.estado !== "EN_PROCESO") {
        throw new BusinessError(
          `retry-polling only applies to EN_PROCESO documents (current: ${doc.estado})`,
          "retry_polling_not_applicable",
        );
      }
      const updated = await prisma.sriDocument.update({
        where: { id: doc.id },
        data: {
          pollAttempts: 0,
          nextPollAt: new Date(),
        },
      });
      req.log?.info(
        {
          event: "sri.retry_polling_requested",
          companyId: callerCompanyId,
          documentId: doc.id,
        },
        "polling retry requested",
      );
      res.json({
        claveAcceso: updated.claveAcceso,
        estado: updated.estado,
        pollAttempts: updated.pollAttempts,
        nextPollAt: updated.nextPollAt?.toISOString() ?? null,
      });
    },
  );

  return router;
}
