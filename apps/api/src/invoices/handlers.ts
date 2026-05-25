/**
 * Invoice CRUD + preview-totals handlers (SPEC-0032 + SPEC-0033).
 *
 * Mount table (in `routes.ts`):
 *
 *   POST   /api/v1/invoices                     invoice.create
 *   GET    /api/v1/invoices                     invoice.read   (cursor pagination)
 *   GET    /api/v1/invoices/:id                 invoice.read
 *   PATCH  /api/v1/invoices/:id                 invoice.create (BORRADOR only)
 *   DELETE /api/v1/invoices/:id                 invoice.create (BORRADOR only)
 *   POST   /api/v1/invoices/preview-totals      invoice.read   (no persistence)
 *
 * Hard rules enforced here (mirrored from SPEC-0033 §6 + ai/context/security.md):
 *
 *   - `companyId` ALWAYS from `req.companyId` (populated by `requireTenant`).
 *     The Zod schemas reject `claveAcceso` and `companyId` on the way in;
 *     anything that slips past the schema is ignored by the handler.
 *   - Cross-tenant probes return 404 (the same shape as "not found") so
 *     enumeration is impossible.
 *   - Edits / deletes refuse `estado != BORRADOR` with 422 `code:"locked"`.
 *   - Server recomputes every total via `computeInvoice`; the body's
 *     `totalSinImpuestos|importeTotal|baseImponible|valor` (if any) is
 *     ignored.
 *   - All mutations audit: `invoice.created|updated|deleted` rows. Payload
 *     never contains customer PII or line bodies — only the invoice id,
 *     estado, totals summary.
 */
import type { Request, RequestHandler } from "express";
import { Prisma } from "@facturador/db";
import type { Customer, PrismaClient } from "@facturador/db";
import { z } from "zod";
import {
  PreviewTotalsRequestSchema,
  type CreateInvoice,
  type UpdateInvoice,
} from "@facturador/contracts/invoices";
import { AuthError, BusinessError, NotFoundError, ValidationError } from "@facturador/utils/errors";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import type { Logger } from "@facturador/logger";
import { computeInvoice, type ComputeInvoiceInput } from "./compute.js";
import {
  validateCreatePayload,
  validateUpdatePayload,
  formatFechaEmisionLocal,
  parseFechaEmision,
} from "./validate.js";
import {
  createInvoiceDraft,
  findInvoiceById,
  listInvoices,
  replaceInvoiceDraft,
  softDeleteDraft,
  type InvoiceWithChildren,
  type PersistableAdicional,
  type PersistableLine,
  type PersistablePayment,
} from "./repository.js";

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

const ListQuerySchema = z
  .object({
    estado: z
      .union([
        z.enum(["BORRADOR", "EMITIDO", "ANULADO"]),
        z
          .array(z.enum(["BORRADOR", "EMITIDO", "ANULADO"]))
          .min(1)
          .max(3),
      ])
      .optional(),
    q: z.string().min(1).max(100).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(40).optional(),
  })
  .strict();

export interface InvoiceHandlerDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export interface InvoiceHandlers {
  createInvoice: RequestHandler;
  getInvoice: RequestHandler;
  listInvoices: RequestHandler;
  updateInvoice: RequestHandler;
  deleteInvoice: RequestHandler;
  previewTotals: RequestHandler;
}

// ---------------------------------------------------------------------------
// Wire response shapes — the on-the-wire representations of an InvoiceWithChildren.
// ---------------------------------------------------------------------------

interface InvoiceLineWire {
  orden: number;
  codigoPrincipal: string | null;
  codigoAuxiliar: string | null;
  descripcion: string;
  unidadMedida: string | null;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  precioTotalSinImpuesto: number;
  impuestos: readonly {
    codigo: string;
    codigoPorcentaje: string;
    tarifa: number;
    baseImponible: number;
    valor: number;
  }[];
}

interface InvoicePaymentWire {
  orden: number;
  formaPago: string;
  total: number;
  plazo: number | null;
  unidadTiempo: string | null;
}

interface InvoiceAdicionalWire {
  orden: number;
  nombre: string;
  valor: string;
}

interface InvoiceDetailWire {
  id: string;
  companyId: string;
  customerId: string;
  emissionPointId: string;
  estado: string;
  codDoc: string;
  estab: string;
  ptoEmi: string;
  secuencial: string | null;
  claveAcceso: string | null;
  fechaEmision: string;
  fechaEmisionLocal: string;
  moneda: string;
  ambiente: string;
  tipoEmision: string;
  obligadoContabilidad: boolean;
  contribuyenteEspecial: string | null;
  totalSinImpuestos: number;
  totalDescuento: number;
  totalConImpuestos: readonly {
    codigo: string;
    codigoPorcentaje: string;
    tarifa: number;
    baseImponible: number;
    valor: number;
  }[];
  propina: number;
  importeTotal: number;
  sriEstado: string | null;
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  emittedAt: string | null;
  mensajes: readonly unknown[] | null;
  lines: InvoiceLineWire[];
  payments: InvoicePaymentWire[];
  adicionales: InvoiceAdicionalWire[];
  createdAt: string;
  updatedAt: string;
}

function dec(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return 0;
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d === null || d === undefined ? null : d.toISOString();
}

export function toInvoiceDetailWire(row: InvoiceWithChildren): InvoiceDetailWire {
  const sriDocLike = row as InvoiceWithChildren & {
    numeroAutorizacion?: string | null;
    fechaAutorizacion?: Date | null;
  };
  return {
    id: row.id,
    companyId: row.companyId,
    customerId: row.customerId,
    emissionPointId: row.emissionPointId,
    estado: row.estado,
    codDoc: row.codDoc,
    estab: row.estab,
    ptoEmi: row.ptoEmi,
    secuencial: row.secuencial,
    claveAcceso: row.claveAcceso,
    fechaEmision: row.fechaEmision.toISOString(),
    fechaEmisionLocal: row.fechaEmisionLocal,
    moneda: row.moneda,
    ambiente: row.ambiente,
    tipoEmision: row.tipoEmision,
    obligadoContabilidad: row.obligadoContabilidad,
    contribuyenteEspecial: row.contribuyenteEspecial,
    totalSinImpuestos: dec(row.totalSinImpuestos),
    totalDescuento: dec(row.totalDescuento),
    totalConImpuestos: (row.totalsJson ?? []) as unknown as readonly {
      codigo: string;
      codigoPorcentaje: string;
      tarifa: number;
      baseImponible: number;
      valor: number;
    }[],
    propina: dec(row.propina),
    importeTotal: dec(row.importeTotal),
    sriEstado: row.sriEstado ?? null,
    numeroAutorizacion: sriDocLike.numeroAutorizacion ?? null,
    fechaAutorizacion: isoOrNull(sriDocLike.fechaAutorizacion ?? null),
    emittedAt: isoOrNull(row.emittedAt),
    mensajes: (row.mensajesJson as readonly unknown[] | null) ?? null,
    lines: row.lines
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((l) => ({
        orden: l.orden,
        codigoPrincipal: l.codigoPrincipal,
        codigoAuxiliar: l.codigoAuxiliar,
        descripcion: l.descripcion,
        unidadMedida: l.unidadMedida,
        cantidad: dec(l.cantidad),
        precioUnitario: dec(l.precioUnitario),
        descuento: dec(l.descuento),
        precioTotalSinImpuesto: dec(l.precioTotalSinImpuesto),
        impuestos: (l.impuestosJson ?? []) as unknown as readonly {
          codigo: string;
          codigoPorcentaje: string;
          tarifa: number;
          baseImponible: number;
          valor: number;
        }[],
      })),
    payments: row.payments
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((p) => ({
        orden: p.orden,
        formaPago: p.formaPago,
        total: dec(p.total),
        plazo: p.plazo === null ? null : dec(p.plazo),
        unidadTiempo: p.unidadTiempo,
      })),
    adicionales: row.adicionales
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((a) => ({ orden: a.orden, nombre: a.nombre, valor: a.valor })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Compute helpers used by both create and update + preview-totals.
// ---------------------------------------------------------------------------

function toComputeInput(
  fechaEmision: Date,
  body: {
    lines: CreateInvoice["lines"];
    payments: CreateInvoice["payments"];
    propina?: number;
    totalDescuento?: number;
  },
): ComputeInvoiceInput {
  return {
    fechaEmision,
    lines: body.lines.map((l, idx) => ({
      orden: idx + 1,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      descuento: l.descuento,
      impuestos: l.impuestos.map((i) => ({
        codigo: i.codigo,
        codigoPorcentaje: i.codigoPorcentaje,
        tarifa: i.tarifa,
      })),
    })),
    payments: body.payments.map((p) => ({
      formaPago: p.formaPago,
      total: p.total,
    })),
    ...(body.totalDescuento === undefined ? {} : { totalDescuento: body.totalDescuento }),
    ...(body.propina === undefined ? {} : { propina: body.propina }),
  };
}

function buildPersistableChildren(
  body: {
    lines: CreateInvoice["lines"];
    payments: CreateInvoice["payments"];
    adicionales?: CreateInvoice["adicionales"];
  },
  totals: ReturnType<typeof computeInvoice>,
): {
  lines: PersistableLine[];
  payments: PersistablePayment[];
  adicionales: PersistableAdicional[];
} {
  const lines = body.lines.map((l, idx) => {
    const computed = totals.lineComputations[idx];
    if (computed === undefined) {
      throw new Error(`Internal: missing line computation at index ${String(idx)}`);
    }
    return {
      orden: idx + 1,
      codigoPrincipal: l.codigoPrincipal ?? null,
      codigoAuxiliar: l.codigoAuxiliar ?? null,
      descripcion: l.descripcion,
      unidadMedida: l.unidadMedida ?? null,
      cantidad: typeof l.cantidad === "string" ? l.cantidad : Number(l.cantidad),
      precioUnitario:
        typeof l.precioUnitario === "string" ? l.precioUnitario : Number(l.precioUnitario),
      descuento: typeof l.descuento === "string" ? l.descuento : Number(l.descuento),
      precioTotalSinImpuesto: computed.precioTotalSinImpuesto,
      impuestos: computed.impuestos.map((i) => ({
        codigo: i.codigo,
        codigoPorcentaje: i.codigoPorcentaje,
        tarifa: i.tarifa,
        baseImponible: i.baseImponible,
        valor: i.valor,
      })),
    } satisfies PersistableLine;
  });
  const payments = body.payments.map(
    (p, idx) =>
      ({
        orden: idx + 1,
        formaPago: p.formaPago,
        total: typeof p.total === "string" ? Number.parseFloat(p.total) : p.total,
        plazo:
          p.plazo === undefined
            ? null
            : typeof p.plazo === "string"
              ? Number.parseFloat(p.plazo)
              : p.plazo,
        unidadTiempo: p.unidadTiempo ?? null,
      }) satisfies PersistablePayment,
  );
  const adicionales = (body.adicionales ?? []).map(
    (a, idx) =>
      ({
        orden: idx + 1,
        nombre: a.nombre,
        valor: a.valor,
      }) satisfies PersistableAdicional,
  );
  return { lines, payments, adicionales };
}

// ---------------------------------------------------------------------------
// Customer resolution — handles `customerId` or inline `customer` per CreateInvoiceSchema.
// ---------------------------------------------------------------------------

/**
 * Resolve the customer to attach to a draft invoice.
 *
 * - When `customerId` is provided: load by `(id, companyId)`. Cross-tenant
 *   probes throw `NotFoundError("customer")`.
 * - When `customer` is provided inline: out-of-scope for v1 (the form
 *   contract reserves the slot but the orchestrator must use the existing
 *   customer catalog endpoints). Returns 422 directing the caller.
 */
async function resolveCustomer(
  prisma: PrismaClient,
  companyId: string,
  body: { customerId?: string | undefined; customer?: unknown },
): Promise<Customer> {
  if (typeof body.customerId === "string") {
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, companyId, deletedAt: null },
    });
    if (customer === null) throw new NotFoundError("customer");
    return customer;
  }
  // Inline customer creation lives in the customer router; we only accept
  // an existing customerId at the invoice level (SPEC-0032 keeps the
  // create-on-the-fly path out of v1).
  throw new BusinessError(
    "customer must be referenced by id; create the customer first via /api/v1/customers",
    "invoice.customer_required",
  );
}

async function resolveEmissionPoint(
  prisma: PrismaClient,
  companyId: string,
  emissionPointId: string,
): Promise<{
  emissionPoint: { id: string; codigo: string; companyId: string };
  estab: string;
}> {
  const ep = await prisma.emissionPoint.findFirst({
    where: { id: emissionPointId, companyId, deletedAt: null },
    include: { establecimiento: true },
  });
  if (ep === null) throw new NotFoundError("emission_point");
  return {
    emissionPoint: { id: ep.id, codigo: ep.codigo, companyId: ep.companyId },
    estab: ep.establecimiento.codigo,
  };
}

async function loadCompany(
  prisma: PrismaClient,
  companyId: string,
): Promise<{
  ambiente: string;
  tipoEmision: string;
  obligadoContabilidad: boolean;
  contribuyenteEspecial: string | null;
}> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: {
      ambiente: true,
      tipoEmision: true,
      obligadoContabilidad: true,
      contribuyenteEspecial: true,
    },
  });
  if (company === null) throw new NotFoundError("company");
  return company;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function buildInvoiceHandlers(deps: InvoiceHandlerDeps): InvoiceHandlers {
  const { prisma, logger } = deps;

  /**
   * `POST /api/v1/invoices` — create a new BORRADOR.
   *
   * Server computes all totals; server pins `companyId` from session.
   * Body cannot supply `claveAcceso` or `secuencial` (the contract schema
   * has no field for either; the orchestrator owns both).
   */
  const createInvoice: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();

      // Defence-in-depth: a body field named `claveAcceso` MUST NOT survive.
      // The contract schema doesn't declare it but Zod won't strip unknown
      // fields by default. We explicitly reject any attempt to inject it.
      assertNoClaveAcceso(req.body);

      const { parsed, fechaEmision } = validateCreatePayload(req.body, {
        now: new Date(),
      });

      const customer = await resolveCustomer(prisma, companyId, parsed);
      const ep = await resolveEmissionPoint(prisma, companyId, parsed.emissionPointId);
      const company = await loadCompany(prisma, companyId);

      const totals = computeInvoice(
        toComputeInput(fechaEmision, {
          lines: parsed.lines,
          payments: parsed.payments,
          ...(parsed.propina === undefined ? {} : { propina: Number(parsed.propina) }),
          ...(parsed.totalDescuento === undefined
            ? {}
            : { totalDescuento: Number(parsed.totalDescuento) }),
        }),
      );

      const persistable = buildPersistableChildren(parsed, totals);

      const created = await createInvoiceDraft(prisma, {
        companyId,
        customerId: customer.id,
        emissionPointId: ep.emissionPoint.id,
        estab: ep.estab,
        ptoEmi: ep.emissionPoint.codigo,
        fechaEmision,
        fechaEmisionLocal: formatFechaEmisionLocal(fechaEmision),
        ambiente: company.ambiente,
        tipoEmision: company.tipoEmision,
        obligadoContabilidad: company.obligadoContabilidad,
        contribuyenteEspecial: company.contribuyenteEspecial,
        totals,
        lines: persistable.lines,
        payments: persistable.payments,
        adicionales: persistable.adicionales,
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.created",
          entity: "Invoice",
          entityId: created.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            emissionPointId: ep.emissionPoint.id,
            estab: ep.estab,
            ptoEmi: ep.emissionPoint.codigo,
            importeTotal: totals.importeTotal,
            lineCount: persistable.lines.length,
          },
        },
      );

      res.status(201).json(toInvoiceDetailWire(created));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `GET /api/v1/invoices/:id` — detail.
   */
  const getInvoice: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      const row = await findInvoiceById(prisma, { id, companyId });
      if (row === null) throw new NotFoundError("invoice");
      res.status(200).json(toInvoiceDetailWire(row));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `GET /api/v1/invoices` — list (cursor-paginated).
   */
  const list: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const query = ListQuerySchema.parse(req.query);
      const limit = query.limit ?? 20;
      const estado =
        query.estado === undefined
          ? undefined
          : Array.isArray(query.estado)
            ? query.estado
            : [query.estado];

      const result = await listInvoices(prisma, {
        companyId,
        limit,
        ...(estado === undefined ? {} : { estado }),
        ...(query.from === undefined ? {} : { from: parseFechaEmision(query.from) }),
        ...(query.to === undefined ? {} : { to: parseFechaEmision(query.to) }),
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });

      res.status(200).json({
        items: result.items.map((r) => ({
          id: r.id,
          estado: r.estado,
          sriEstado: r.sriEstado,
          fechaEmision: r.fechaEmision.toISOString(),
          customerRazonSocial: r.customerRazonSocial,
          estab: r.estab,
          ptoEmi: r.ptoEmi,
          secuencial: r.secuencial,
          claveAcceso: r.claveAcceso,
          importeTotal: dec(r.importeTotal),
        })),
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/invoices/:id` — edit a BORRADOR.
   *
   * `estado != BORRADOR` returns 422 `code:"locked"`.
   * Edits cannot change `emissionPointId` (would require new secuencial).
   * Server recomputes totals.
   */
  const updateInvoice: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      assertNoClaveAcceso(req.body);

      const { parsed, fechaEmision } = validateUpdatePayload(req.body, {
        now: new Date(),
      });

      const existing = await findInvoiceById(prisma, { id, companyId });
      if (existing === null) throw new NotFoundError("invoice");
      if (existing.estado !== "BORRADOR") {
        throw new BusinessError(`Cannot edit invoice in estado=${existing.estado}`, "locked");
      }

      // Apply patch field-by-field on top of the existing snapshot.
      const newFechaEmision = fechaEmision ?? existing.fechaEmision;
      const linesInput = parsed.lines ?? legacyLines(existing);
      const paymentsInput = parsed.payments ?? legacyPayments(existing);
      const adicionalesInput = parsed.adicionales ?? legacyAdicionales(existing);

      const customerId =
        parsed.customerId !== undefined
          ? (await resolveCustomer(prisma, companyId, parsed)).id
          : existing.customerId;

      const computeBody = {
        lines: linesInput,
        payments: paymentsInput,
        ...(parsed.propina === undefined
          ? { propina: dec(existing.propina) }
          : { propina: Number(parsed.propina) }),
        ...(parsed.totalDescuento === undefined
          ? { totalDescuento: dec(existing.totalDescuento) }
          : { totalDescuento: Number(parsed.totalDescuento) }),
      };
      const totals = computeInvoice(toComputeInput(newFechaEmision, computeBody));

      const persistable = buildPersistableChildren(
        { lines: linesInput, payments: paymentsInput, adicionales: adicionalesInput },
        totals,
      );

      const updated = await replaceInvoiceDraft(prisma, {
        id,
        companyId,
        ...(parsed.customerId === undefined ? {} : { customerId }),
        ...(fechaEmision === null
          ? {}
          : {
              fechaEmision: newFechaEmision,
              fechaEmisionLocal: formatFechaEmisionLocal(newFechaEmision),
            }),
        totals,
        lines: persistable.lines,
        payments: persistable.payments,
        adicionales: persistable.adicionales,
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.updated",
          entity: "Invoice",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            changed: Object.keys(parsed),
            importeTotal: totals.importeTotal,
          },
        },
      );

      res.status(200).json(toInvoiceDetailWire(updated));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `DELETE /api/v1/invoices/:id` — soft-delete a BORRADOR.
   */
  const deleteInvoice: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const existing = await findInvoiceById(prisma, { id, companyId });
      if (existing === null) throw new NotFoundError("invoice");
      if (existing.estado !== "BORRADOR") {
        throw new BusinessError(`Cannot delete invoice in estado=${existing.estado}`, "locked");
      }
      await softDeleteDraft(prisma, { id, companyId });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "invoice.deleted",
          entity: "Invoice",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { estado: existing.estado },
        },
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/invoices/preview-totals` — pure compute, no persistence.
   *
   * Same body as create. Returns the computed totals so the UI can show
   * the live summary on the create form (SPEC-0042 §6.4).
   */
  const previewTotals: RequestHandler = (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      assertNoClaveAcceso(req.body);
      const body = PreviewTotalsRequestSchema.parse(req.body);
      const fechaEmision = parseFechaEmision(body.fechaEmision);

      const totals = computeInvoice(
        toComputeInput(fechaEmision, {
          lines: body.lines,
          payments: body.payments,
          ...(body.propina === undefined ? {} : { propina: Number(body.propina) }),
          ...(body.totalDescuento === undefined
            ? {}
            : { totalDescuento: Number(body.totalDescuento) }),
        }),
      );

      res.status(200).json({
        lines: totals.lineComputations.map((l) => ({
          precioTotalSinImpuesto: l.precioTotalSinImpuesto,
          impuestos: l.impuestos,
        })),
        totalSinImpuestos: totals.totalSinImpuestos,
        totalDescuento: totals.totalDescuento,
        totalConImpuestos: totals.totalImpuestos,
        propina: totals.propina,
        importeTotal: totals.importeTotal,
        paymentsBalanced: totals.paymentsBalanced,
      });
    } catch (err) {
      next(err);
    }
  };

  return {
    createInvoice,
    getInvoice,
    listInvoices: list,
    updateInvoice,
    deleteInvoice,
    previewTotals,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reject any body that includes `claveAcceso`. The contract schema does not
 * declare the field; this is defence-in-depth so a hostile client cannot
 * smuggle a forged clave on the way to persistence. The server is the only
 * party allowed to compute the clave (SPEC-0033 + ai/context/security.md).
 */
function assertNoClaveAcceso(body: unknown): void {
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

/**
 * Convert persisted line rows back into the `UpdateInvoice` line shape.
 * Used by the PATCH handler when the body omits `lines` — the existing
 * lines are re-run through `computeInvoice` so the totals snapshot stays
 * canonical even if the patched header field (e.g. `propina`) changes the
 * arithmetic.
 */
function legacyLines(row: InvoiceWithChildren): NonNullable<UpdateInvoice["lines"]> {
  type LineOut = NonNullable<UpdateInvoice["lines"]>[number];
  return row.lines
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((l) => {
      const out: LineOut = {
        descripcion: l.descripcion,
        cantidad: dec(l.cantidad),
        precioUnitario: dec(l.precioUnitario),
        descuento: dec(l.descuento),
        impuestos: (
          l.impuestosJson as unknown as readonly {
            codigo: string;
            codigoPorcentaje: string;
            tarifa: number;
          }[]
        ).map((i) => ({
          codigo: i.codigo as "2" | "3" | "5",
          codigoPorcentaje: i.codigoPorcentaje,
          tarifa: i.tarifa,
        })),
      };
      if (l.codigoPrincipal !== null) out.codigoPrincipal = l.codigoPrincipal;
      if (l.codigoAuxiliar !== null) out.codigoAuxiliar = l.codigoAuxiliar;
      if (l.unidadMedida !== null) out.unidadMedida = l.unidadMedida;
      return out;
    });
}

function legacyPayments(row: InvoiceWithChildren): NonNullable<UpdateInvoice["payments"]> {
  type PaymentOut = NonNullable<UpdateInvoice["payments"]>[number];
  return row.payments
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((p) => {
      const out: PaymentOut = {
        formaPago: p.formaPago as PaymentOut["formaPago"],
        total: dec(p.total),
      };
      if (p.plazo !== null) out.plazo = dec(p.plazo);
      if (p.unidadTiempo !== null) out.unidadTiempo = p.unidadTiempo;
      return out;
    });
}

function legacyAdicionales(row: InvoiceWithChildren): NonNullable<UpdateInvoice["adicionales"]> {
  return row.adicionales
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((a) => ({ nombre: a.nombre, valor: a.valor }));
}
