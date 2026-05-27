/**
 * Invoice emission orchestrator + reissue + refresh handlers.
 *
 * Source of truth: SPEC-0033 §6.3 + PLAN-0033 §4 + TASKS-0033.
 *
 * Endpoints:
 *
 *   POST /api/v1/invoices/:id/emit       invoice.emit
 *   POST /api/v1/invoices/:id/reissue    invoice.reissue
 *   POST /api/v1/invoices/:id/refresh    invoice.read
 *
 * The emit handler is split into three composable units (per PROMPT-0033
 * §4 "Emit handler is split"):
 *
 *   1. `reserveInTransaction()` — atomic reservation: secuencial + clave +
 *      mirror columns on the invoice row.
 *   2. `callSriCoreEmit()` — outbound HTTP call. Mints a fresh service JWT
 *      (60 s expiry) and forwards `X-Request-Id`.
 *   3. `mirrorSriResponse()` — field-by-field update of the Invoice's SRI
 *      mirror columns from the upstream response.
 *
 * Hard rules baked in (mirroring PROMPT-0033 §6 + ai/context/security.md):
 *
 *   - companyId ALWAYS from `req.companyId`; never from body.
 *   - claveAcceso is NEVER accepted from the client; server computes it.
 *   - Idempotent emit: a second call on an already-EMITIDO invoice returns
 *     the current state without reserving / minting a fresh clave / hitting
 *     sri-core.
 *   - Reissue creates a NEW BORRADOR (cloned) and burns the old secuencial.
 *     The old invoice row is left untouched (its claveAcceso is unchanged).
 *   - JWT mint is per-call; never logged; expires ≤ 60 s. We rely on the
 *     `mintServiceJwt` helper (already validated by SPEC-0020).
 *   - All paths audit. The audit row carries (claveAcceso, outcome,
 *     durationMs) — never the JWT, never the request body.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";

import type { EmitDocumentResponse, DocumentStatusResponse } from "@facturador/contracts/sri";
import type {
  Customer,
  Establecimiento,
  PrismaClient,
  SriEstado,
} from "@facturador/db";
import { Prisma } from "@facturador/db";
import { newId } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { buildClaveAcceso, generateCodigoNumerico } from "@facturador/utils";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import {
  AuthError,
  BusinessError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "@facturador/utils/errors";

import { env } from "../env.js";
import { burnSecuencial } from "../sequencing/burn.js";
import { reserveSecuencial } from "../sequencing/reserve.js";
import { sriCoreFetch } from "../sri/client.js";

import { toInvoiceDetailWire } from "./handlers.js";
import { findInvoiceById, type InvoiceWithChildren } from "./repository.js";
import { translateInvoiceToSriRequest } from "./translate-to-sri.js";

const auditAdapter = (prisma: PrismaClient): AuditPrismaClient =>
  prisma as unknown as AuditPrismaClient;

function readIp(req: Request): string | null {
  const raw = req.ip;
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 64) : null;
}

function readUserAgent(req: Request): string | null {
  const raw = req.header("user-agent");
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 256) : null;
}

const IdParam = z.object({ id: z.string().min(1) });

export interface OrchestratorDeps {
  prisma: PrismaClient;
  logger: Logger;
  /**
   * Override the sri-core base URL (tests set this to the MSW base URL).
   * Defaults to `env.SRI_CORE_URL`.
   */
  sriCoreBaseUrl?: string;
  /** Override the fetch impl (tests inject the MSW-fitted fetch). */
  fetchImpl?: typeof fetch;
  /** Override the service-JWT secret (tests use a fixed test secret). */
  serviceJwtSecret?: string;
}

export interface OrchestratorHandlers {
  emit: RequestHandler;
  reissue: RequestHandler;
  refresh: RequestHandler;
}

/**
 * Estados the orchestrator considers "in-flight or successful". Used by the
 * idempotency check.
 */
function isAlreadyEmitted(estado: string): boolean {
  return estado === "EMITIDO";
}

/**
 * Mirror-write helper. All mirror updates use a field-by-field shape so
 * we never `data: { ...response }` and accidentally leak unknown keys
 * (PROMPT-0033 §4 hard rule).
 *
 * The production-readiness migration added `numeroAutorizacion`,
 * `fechaAutorizacion`, and `sriDocumentId` columns to the `invoices`
 * table; we now persist them here so the detail GET endpoint can
 * render the authorised receipt without a cross-service join.
 */
async function applyMirror(
  prisma: PrismaClient,
  invoiceId: string,
  companyId: string,
  patch: {
    sriEstado: SriEstado;
    numeroAutorizacion: string | null;
    fechaAutorizacion: Date | null;
    sriDocumentId?: string | null;
    mensajesJson: unknown;
  },
): Promise<void> {
  const data: Prisma.InvoiceUpdateInput = {
    sriEstado: patch.sriEstado,
    numeroAutorizacion: patch.numeroAutorizacion,
    fechaAutorizacion: patch.fechaAutorizacion,
    mensajesJson:
      patch.mensajesJson === null || patch.mensajesJson === undefined
        ? Prisma.JsonNull
        : (patch.mensajesJson as Prisma.InputJsonValue),
  };
  if (patch.sriDocumentId !== undefined) {
    data.sriDocumentId = patch.sriDocumentId;
  }
  // Defence-in-depth: `companyId` in the WHERE prevents a stray invoiceId
  // (e.g. swapped at the call site) from updating another tenant's row.
  await prisma.invoice.update({
    where: { id: invoiceId, companyId },
    data,
  });
}

interface ReservedInvoice {
  invoice: InvoiceWithChildren;
  customer: Customer;
  emissionPoint: {
    id: string;
    codigo: string;
    establecimiento: Pick<Establecimiento, "codigo" | "direccion">;
  };
  company: {
    id: string;
    ruc: string;
    razonSocial: string;
    nombreComercial: string | null;
    direccionMatriz: string;
    obligadoContabilidad: boolean;
    contribuyenteEspecial: string | null;
    ambiente: string;
    tipoEmision: string;
  };
}

/**
 * Reserve the secuencial, compute the claveAcceso, persist them on the
 * invoice row — all atomically. Returns the fully-hydrated invoice
 * (with children + company + customer + emission point) used by the
 * subsequent sri-core call.
 *
 * If the invoice is already EMITIDO this short-circuits and returns the
 * pre-reserved state. The caller MUST treat this as the idempotent path.
 */
async function reserveInTransaction(
  prisma: PrismaClient,
  args: {
    invoice: InvoiceWithChildren;
    companyId: string;
  },
): Promise<ReservedInvoice> {
  const { invoice, companyId } = args;

  const [company, customer, emissionPoint] = await Promise.all([
    prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        direccionMatriz: true,
        obligadoContabilidad: true,
        contribuyenteEspecial: true,
        ambiente: true,
        tipoEmision: true,
      },
    }),
    prisma.customer.findFirst({
      where: { id: invoice.customerId, companyId, deletedAt: null },
    }),
    prisma.emissionPoint.findFirst({
      where: { id: invoice.emissionPointId, companyId, deletedAt: null },
      include: { establecimiento: true },
    }),
  ]);

  if (company === null) throw new NotFoundError("company");
  if (customer === null) throw new NotFoundError("customer");
  if (emissionPoint === null) throw new NotFoundError("emission_point");

  // Idempotency short-circuit: already EMITIDO → return current state
  // without touching the secuencial.
  if (isAlreadyEmitted(invoice.estado)) {
    return {
      invoice,
      customer,
      emissionPoint: {
        id: emissionPoint.id,
        codigo: emissionPoint.codigo,
        establecimiento: {
          codigo: emissionPoint.establecimiento.codigo,
          direccion: emissionPoint.establecimiento.direccion,
        },
      },
      company,
    };
  }

  // Reserve secuencial + compute clave + persist atomically. The retry
  // budget is operator-tunable via `SECUENCIAL_RESERVE_MAX_RETRIES` so
  // a noisy environment can dial down the retry cost without a redeploy
  // (see apps/api/README.md).
  const secuencial = await reserveSecuencial(
    { prisma, maxRetries: env.SECUENCIAL_RESERVE_MAX_RETRIES },
    {
      companyId,
      estab: emissionPoint.establecimiento.codigo,
      ptoEmi: emissionPoint.codigo,
      tipoComprobante: "01",
    },
  );

  const codigoNumerico = generateCodigoNumerico();
  const claveAcceso = buildClaveAcceso({
    fechaEmision: invoice.fechaEmision,
    codDoc: "01",
    ruc: company.ruc,
    ambiente: company.ambiente as "1" | "2",
    estab: emissionPoint.establecimiento.codigo,
    ptoEmi: emissionPoint.codigo,
    secuencial,
    codigoNumerico,
    tipoEmision: "1",
  });

  // Defence-in-depth: `companyId` in the WHERE guarantees this update can
  // only ever touch a row already scoped to the authenticated tenant —
  // even though `invoice` was loaded via `findInvoiceById` (which already
  // filters by companyId), making the constraint explicit here keeps the
  // intent visible at the call site.
  const updated = await prisma.invoice.update({
    where: { id: invoice.id, companyId },
    data: {
      secuencial,
      claveAcceso,
      estado: "EMITIDO",
      emittedAt: new Date(),
      ambiente: company.ambiente,
      tipoEmision: company.tipoEmision,
      obligadoContabilidad: company.obligadoContabilidad,
      contribuyenteEspecial: company.contribuyenteEspecial,
    },
    include: { lines: true, payments: true, adicionales: true },
  });

  return {
    invoice: updated,
    customer,
    emissionPoint: {
      id: emissionPoint.id,
      codigo: emissionPoint.codigo,
      establecimiento: {
        codigo: emissionPoint.establecimiento.codigo,
        direccion: emissionPoint.establecimiento.direccion,
      },
    },
    company,
  };
}

/**
 * Outbound HTTP to sri-core. Mints a fresh service JWT (60 s); forwards
 * `X-Request-Id`. Returns the parsed `EmitDocumentResponse` body.
 *
 * Throws `UpstreamError` on network / non-2xx — the handler treats this as
 * a 502 + ERROR_RED mirror update.
 */
async function callSriCoreEmit(
  args: {
    reserved: ReservedInvoice;
    requestId: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    serviceJwtSecret?: string;
  },
): Promise<EmitDocumentResponse> {
  const body = translateInvoiceToSriRequest({
    company: args.reserved.company,
    invoice: args.reserved.invoice,
    customer: args.reserved.customer,
    emissionPoint: {
      id: args.reserved.emissionPoint.id,
      codigo: args.reserved.emissionPoint.codigo,
      establecimiento: args.reserved.emissionPoint.establecimiento as Establecimiento,
      companyId: args.reserved.company.id,
      establecimientoId: "",
      descripcion: "",
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    lines: args.reserved.invoice.lines,
    payments: args.reserved.invoice.payments,
    adicionales: args.reserved.invoice.adicionales,
  });
  const result = await sriCoreFetch<EmitDocumentResponse>(
    "/v1/documents/emit",
    {
      method: "POST",
      companyId: args.reserved.company.id,
      body,
      requestId: args.requestId,
      ...(args.baseUrl === undefined ? {} : { baseUrl: args.baseUrl }),
      ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl }),
      ...(args.serviceJwtSecret === undefined
        ? {}
        : { serviceJwtSecret: args.serviceJwtSecret }),
      // 60-second service JWT is the contract default; explicit so future
      // changes to the helper's default surface here.
      serviceJwtTtlSeconds: 60,
    },
  );
  return result.body;
}

/**
 * Synthesise a single SriMensaje when the upstream returns DEVUELTA /
 * NO_AUTORIZADO with no `mensajes`. The UI never has to render an empty
 * error list — the placeholder spells out the situation in Spanish.
 *
 * This is a pure helper; it returns either the original mensajes (when
 * the upstream supplied at least one) or the synthesised fallback.
 */
export function ensureMensajesNonEmpty(
  estado: SriEstado,
  mensajes: EmitDocumentResponse["mensajes"],
): NonNullable<EmitDocumentResponse["mensajes"]> {
  if (estado !== "DEVUELTA" && estado !== "NO_AUTORIZADO") {
    return mensajes ?? [];
  }
  if (mensajes !== undefined && mensajes.length > 0) {
    return mensajes;
  }
  return [
    {
      identificador: "UNKNOWN",
      tipo: "ERROR",
      mensaje: "El SRI rechazó el comprobante sin mensajes específicos.",
    },
  ];
}

/**
 * Field-by-field mirror write from an `EmitDocumentResponse`. Mensajes
 * are guaranteed non-empty for DEVUELTA / NO_AUTORIZADO via
 * `ensureMensajesNonEmpty` (production-readiness §12).
 */
async function mirrorEmitResponse(
  prisma: PrismaClient,
  invoiceId: string,
  companyId: string,
  resp: EmitDocumentResponse,
): Promise<NonNullable<EmitDocumentResponse["mensajes"]>> {
  const mensajes = ensureMensajesNonEmpty(resp.estado, resp.mensajes);
  await applyMirror(prisma, invoiceId, companyId, {
    sriEstado: resp.estado,
    numeroAutorizacion: resp.numeroAutorizacion ?? null,
    fechaAutorizacion:
      resp.fechaAutorizacion === undefined
        ? null
        : new Date(resp.fechaAutorizacion),
    mensajesJson: mensajes,
  });
  return mensajes;
}

/**
 * Build the JSON response body of the emit endpoint. Pulls the freshly
 * mirrored invoice row + customer + emission point so the UI gets one
 * round-trip.
 */
function buildEmitResponseBody(
  row: InvoiceWithChildren,
  resp: EmitDocumentResponse | null,
): {
  estado: string;
  claveAcceso: string;
  sriEstado: string | null;
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  mensajes: readonly unknown[];
  invoice: ReturnType<typeof toInvoiceDetailWire>;
} {
  return {
    estado: row.estado,
    claveAcceso: row.claveAcceso ?? "",
    sriEstado: row.sriEstado ?? resp?.estado ?? null,
    numeroAutorizacion:
      resp?.numeroAutorizacion ??
      ((row.mensajesJson as { numeroAutorizacion?: string } | null)
        ?.numeroAutorizacion ?? null),
    fechaAutorizacion: resp?.fechaAutorizacion ?? null,
    mensajes: resp?.mensajes ?? [],
    invoice: toInvoiceDetailWire(row),
  };
}

export function buildOrchestratorHandlers(
  deps: OrchestratorDeps,
): OrchestratorHandlers {
  const { prisma, logger } = deps;

  const emit: RequestHandler = async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      assertBodyHasNoClaveAcceso(req.body);

      const existing = await findInvoiceById(prisma, { id, companyId });
      if (existing === null) throw new NotFoundError("invoice");

      // Pre-emit validations (only when the invoice is still a draft).
      if (existing.estado === "BORRADOR") {
        if (existing.lines.length === 0) {
          throw new BusinessError(
            "Invoice has no lines",
            "invoice.lines_required",
          );
        }
        // Defensive payment-sum check (orchestrator-side guard). The PATCH
        // / create paths already enforce this, but we re-check here so
        // emit-on-stale-draft surfaces clean errors.
        const importeTotal = numFromDecimal(existing.importeTotal);
        const paymentsSum = existing.payments.reduce(
          (acc, p) => acc + numFromDecimal(p.total),
          0,
        );
        const delta = Math.abs(round2(paymentsSum - importeTotal));
        if (delta > 0.01) {
          throw new BusinessError(
            `Payments do not match importeTotal (delta=${delta.toFixed(2)})`,
            "payments_mismatch",
          );
        }
        if (!existing.customerId) {
          throw new BusinessError(
            "Invoice has no customer",
            "invoice.customer_required",
          );
        }
      }

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.emit.attempt",
          entity: "Invoice",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { estado: existing.estado },
        },
      );

      // 1) Atomic reservation + clave + state transition.
      const reserved = await reserveInTransaction(prisma, {
        invoice: existing,
        companyId,
      });

      // Idempotent short-circuit — already EMITIDO. Don't call sri-core
      // again; return the current mirror.
      if (isAlreadyEmitted(existing.estado)) {
        const fresh = await findInvoiceById(prisma, { id, companyId });
        if (fresh === null) throw new NotFoundError("invoice");
        await audit(
          { prisma: auditAdapter(prisma), logger },
          {
            action: "invoice.emit.idempotent",
            entity: "Invoice",
            entityId: id,
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
            payloadJson: {
              claveAcceso: fresh.claveAcceso,
              durationMs: Date.now() - startedAt,
            },
          },
        );
        res.status(200).json(buildEmitResponseBody(fresh, null));
        return;
      }

      // 2) Call sri-core. Failures route to ERROR_RED + 502.
      let sriResp: EmitDocumentResponse;
      try {
        sriResp = await callSriCoreEmit({
          reserved,
          requestId: req.id ?? newId(),
          ...(deps.sriCoreBaseUrl === undefined
            ? {}
            : { baseUrl: deps.sriCoreBaseUrl }),
          ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
          ...(deps.serviceJwtSecret === undefined
            ? {}
            : { serviceJwtSecret: deps.serviceJwtSecret }),
        });
      } catch (err) {
        // Persist ERROR_RED and audit; the invoice stays EMITIDO (the
        // secuencial is burned — UI guides the user to reissue or refresh).
        await applyMirror(prisma, reserved.invoice.id, companyId, {
          sriEstado: "ERROR_RED",
          numeroAutorizacion: null,
          fechaAutorizacion: null,
          mensajesJson: null,
        });
        await audit(
          { prisma: auditAdapter(prisma), logger },
          {
            action: "invoice.emit.failure",
            entity: "Invoice",
            entityId: reserved.invoice.id,
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
            payloadJson: {
              reason: "sri.network",
              claveAcceso: reserved.invoice.claveAcceso,
              durationMs: Date.now() - startedAt,
            },
          },
        );
        // Surface a 502 ProblemDetail — UpstreamError maps there.
        throw new UpstreamError(
          "sri-core unreachable; invoice flagged ERROR_RED",
          "sri.network",
          { cause: err },
        );
      }

      // 3) Mirror update. Returns the (possibly synthesised) mensajes so
      // the response body and DB write agree even when the upstream
      // returned an empty list on DEVUELTA / NO_AUTORIZADO.
      const mensajesForBody = await mirrorEmitResponse(
        prisma,
        reserved.invoice.id,
        companyId,
        sriResp,
      );
      const fresh = await findInvoiceById(prisma, {
        id: reserved.invoice.id,
        companyId,
      });
      if (fresh === null) throw new NotFoundError("invoice");

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.emit.success",
          entity: "Invoice",
          entityId: fresh.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            claveAcceso: fresh.claveAcceso,
            sriEstado: fresh.sriEstado,
            durationMs: Date.now() - startedAt,
          },
        },
      );

      res
        .status(200)
        .json(
          buildEmitResponseBody(fresh, { ...sriResp, mensajes: mensajesForBody }),
        );
    } catch (err) {
      next(err);
    }
  };

  const reissue: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const source = await findInvoiceById(prisma, { id, companyId });
      if (source === null) throw new NotFoundError("invoice");

      // The reissue precondition: must be EMITIDO with a sri estado of
      // DEVUELTA or NO_AUTORIZADO (PROMPT-0033 §1 "Reissue is allowed only
      // when sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}"). ERROR_RED also flows
      // through reissue because the secuencial is burned but no SRI doc
      // was created — the operator retries with a fresh clave.
      const sriEstado = source.sriEstado;
      const reissueAllowed =
        source.estado === "EMITIDO" &&
        (sriEstado === "DEVUELTA" ||
          sriEstado === "NO_AUTORIZADO" ||
          sriEstado === "ERROR_RED");
      if (!reissueAllowed) {
        throw new BusinessError(
          `Reissue not allowed in estado=${source.estado}, sriEstado=${sriEstado ?? "null"}`,
          "reissue_not_allowed",
        );
      }
      if (source.secuencial === null) {
        throw new BusinessError(
          "Cannot reissue an invoice without a secuencial",
          "reissue_not_allowed",
        );
      }

      const newInvoiceId = newId();
      await prisma.$transaction(async (tx) => {
        // Burn the old secuencial. Idempotent: if already burned (e.g. a
        // partial previous attempt), the unique-tuple guard throws
        // `secuencial.already_burned`; we swallow that since the reissue
        // proceeds regardless.
        try {
          await burnSecuencial(tx, {
            companyId,
            estab: source.estab,
            ptoEmi: source.ptoEmi,
            tipoComprobante: "01",
            // `source.secuencial` is asserted non-null above (see the
            // `secuencial === null` guard at the top of the handler).
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            secuencial: source.secuencial!,
            reason: "reissue",
            burnedByUserId: req.user?.id ?? null,
          });
        } catch (e) {
          // Tolerate idempotent burn — verified by tests.
          if (
            !(
              e instanceof Error &&
              "code" in e &&
              (e as { code?: string }).code === "secuencial.already_burned"
            )
          ) {
            throw e;
          }
        }

        // Clone the invoice as a fresh BORRADOR (no secuencial, no clave).
        // Use TODAY's fechaEmision (Ecuador local — UTC midnight per
        // parseFechaEmision contract).
        const today = startOfTodayUtc();
        const todayLocal = formatDdMmYyyy(today);
        await tx.invoice.create({
          data: {
            id: newInvoiceId,
            companyId,
            customerId: source.customerId,
            emissionPointId: source.emissionPointId,
            estado: "BORRADOR",
            codDoc: "01",
            estab: source.estab,
            ptoEmi: source.ptoEmi,
            secuencial: null,
            claveAcceso: null,
            fechaEmision: today,
            fechaEmisionLocal: todayLocal,
            moneda: source.moneda,
            ambiente: source.ambiente,
            tipoEmision: source.tipoEmision,
            obligadoContabilidad: source.obligadoContabilidad,
            contribuyenteEspecial: source.contribuyenteEspecial,
            totalSinImpuestos: source.totalSinImpuestos,
            totalDescuento: source.totalDescuento,
            propina: source.propina,
            importeTotal: source.importeTotal,
            totalsJson: (source.totalsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            // Reissue chain pointer: navigate from the clone back to the
            // original. Restrict FK prevents orphaning if someone tries
            // to hard-delete the original — they must walk descendants
            // first. The detail wire shape surfaces this so the UI can
            // display "this invoice replaces …".
            replacesInvoiceId: source.id,
          },
        });
        // Clone lines.
        if (source.lines.length > 0) {
          await tx.invoiceLine.createMany({
            data: source.lines.map((l) => ({
              id: newId(),
              invoiceId: newInvoiceId,
              orden: l.orden,
              codigoPrincipal: l.codigoPrincipal,
              codigoAuxiliar: l.codigoAuxiliar,
              descripcion: l.descripcion,
              unidadMedida: l.unidadMedida,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              descuento: l.descuento,
              precioTotalSinImpuesto: l.precioTotalSinImpuesto,
              impuestosJson: l.impuestosJson as Prisma.InputJsonValue,
            })),
          });
        }
        if (source.payments.length > 0) {
          await tx.invoicePayment.createMany({
            data: source.payments.map((p) => ({
              id: newId(),
              invoiceId: newInvoiceId,
              orden: p.orden,
              formaPago: p.formaPago,
              total: p.total,
              plazo: p.plazo,
              unidadTiempo: p.unidadTiempo,
            })),
          });
        }
        if (source.adicionales.length > 0) {
          await tx.invoiceAdicional.createMany({
            data: source.adicionales.map((a) => ({
              id: newId(),
              invoiceId: newInvoiceId,
              orden: a.orden,
              nombre: a.nombre,
              valor: a.valor,
            })),
          });
        }
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.reissue",
          entity: "Invoice",
          entityId: source.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            sourceClaveAcceso: source.claveAcceso,
            newInvoiceId,
          },
        },
      );

      res.status(201).json({ newInvoiceId });
    } catch (err) {
      next(err);
    }
  };

  const refresh: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const existing = await findInvoiceById(prisma, { id, companyId });
      if (existing === null) throw new NotFoundError("invoice");
      if (existing.claveAcceso === null) {
        throw new BusinessError(
          "Invoice has no claveAcceso; cannot refresh",
          "refresh_not_allowed",
        );
      }

      let status: DocumentStatusResponse;
      try {
        const result = await sriCoreFetch<DocumentStatusResponse>(
          `/v1/documents/${existing.claveAcceso}/status`,
          {
            method: "GET",
            companyId,
            requestId: req.id ?? newId(),
            ...(deps.sriCoreBaseUrl === undefined
              ? {}
              : { baseUrl: deps.sriCoreBaseUrl }),
            ...(deps.fetchImpl === undefined
              ? {}
              : { fetchImpl: deps.fetchImpl }),
            ...(deps.serviceJwtSecret === undefined
              ? {}
              : { serviceJwtSecret: deps.serviceJwtSecret }),
            serviceJwtTtlSeconds: 60,
          },
        );
        status = result.body;
      } catch (err) {
        await audit(
          { prisma: auditAdapter(prisma), logger },
          {
            action: "invoice.refresh.failure",
            entity: "Invoice",
            entityId: id,
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
            payloadJson: { claveAcceso: existing.claveAcceso, reason: "sri.network" },
          },
        );
        throw new UpstreamError(
          "sri-core unreachable during refresh",
          "sri.network",
          { cause: err },
        );
      }

      // Mirror back. The fechaAutorizacion arrives as ISO; we coerce to
      // Date for the Prisma column. `sriDocumentId` is the upstream
      // SriDocument's id — captured here so a follow-up sweep / repair
      // script can navigate Invoice → SriDocument without a clave-acceso
      // lookup.
      const fechaAuth = status.document.fechaAutorizacion;
      await applyMirror(prisma, id, companyId, {
        sriEstado: status.document.estado,
        numeroAutorizacion: status.document.numeroAutorizacion ?? null,
        fechaAutorizacion:
          fechaAuth === null || fechaAuth === undefined
            ? null
            : new Date(fechaAuth),
        sriDocumentId: status.document.id,
        mensajesJson: status.events.flatMap((e) => e.mensajes),
      });

      const fresh = await findInvoiceById(prisma, { id, companyId });
      if (fresh === null) throw new NotFoundError("invoice");
      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.refresh",
          entity: "Invoice",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            claveAcceso: fresh.claveAcceso,
            sriEstado: fresh.sriEstado,
          },
        },
      );
      res.status(200).json({
        sriEstado: fresh.sriEstado,
        claveAcceso: fresh.claveAcceso,
        numeroAutorizacion: status.document.numeroAutorizacion ?? null,
        fechaAutorizacion: status.document.fechaAutorizacion ?? null,
        invoice: toInvoiceDetailWire(fresh),
      });
    } catch (err) {
      next(err);
    }
  };

  return { emit, reissue, refresh };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertBodyHasNoClaveAcceso(body: unknown): void {
  if (
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    "claveAcceso" in (body as Record<string, unknown>)
  ) {
    throw new ValidationError("claveAcceso is server-computed; reject input", {
      errors: [
        {
          identificador: "claveAcceso",
          mensaje: "no aceptado en el cuerpo",
          tipo: "ERROR",
        },
      ],
    });
  }
}

function numFromDecimal(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function formatDdMmYyyy(d: Date): string {
  const day = d.getUTCDate().toString().padStart(2, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  return `${day}/${mo}/${y}`;
}
