/**
 * Customer catalog handlers (SPEC-0031 §6.1 / §FR-2).
 *
 * Mount table (in `routes.ts`):
 *
 *   GET    /api/v1/customers                       customer.read
 *   GET    /api/v1/customers/:id                   customer.read
 *   POST   /api/v1/customers                       customer.create
 *   POST   /api/v1/customers/consumidor-final      customer.read (idempotent)
 *   PATCH  /api/v1/customers/:id                   customer.update
 *   DELETE /api/v1/customers/:id                   customer.delete (soft)
 *
 * Hard rules enforced here:
 *
 *   - `companyId` ALWAYS from `req.companyId` (populated by `requireTenant`).
 *     Never read from body / query / headers.
 *   - Cross-tenant probes return 404 with the "same shape as not found" so
 *     an attacker cannot enumerate existing customers in another tenant.
 *   - Soft-delete only: handlers set `deletedAt`; reads always filter
 *     `deletedAt IS NULL`.
 *   - List responses exclude PII columns (email, telefono, direccion) per
 *     SPEC-0031 §10. Detail responses include them (the detail call is
 *     intentional and the redaction list in `@facturador/logger` masks them
 *     in logs anyway).
 *   - Audit every mutation: customer.created / updated / deleted. Payload
 *     never contains PII fields — only the customer id + a short summary.
 *   - Manual creation with the consumidor-final fixed identifier
 *     (`07` / `9999999999999`) is rejected with 409 `customer.use_helper`;
 *     the dedicated `/customers/consumidor-final` endpoint is the only path.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";

import type { Customer, PrismaClient } from "@facturador/db";
import { Prisma } from "@facturador/db";
import { newId } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import { AuthError, ConflictError, NotFoundError, ValidationError } from "@facturador/utils/errors";


import { ensureConsumidorFinal } from "./ensure-consumidor-final.js";
import { validateCreate, validateUpdate } from "./validate.js";

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

/**
 * Query-string validator for `GET /api/v1/customers`.
 *
 * `limit` defaults to 20 and caps at 50 (SPEC-0031 §FR-6). `q` is the search
 * term, used as a case-insensitive *prefix* on `razonSocial` (the spec
 * gives us `LIKE 'q%'` semantics so the `(companyId, razonSocial)` btree can
 * be used) and an exact match on `identificacion`. `cursor` is a ULID.
 */
const ListQuerySchema = z
  .object({
    q: z.string().min(1).max(100).optional(),
    tipoIdentificacion: z.enum(["04", "05", "06", "07", "08"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(40).optional(),
  })
  .strict();

export interface CustomerHandlerDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export interface CustomerHandlers {
  listCustomers: RequestHandler;
  getCustomer: RequestHandler;
  createCustomer: RequestHandler;
  updateCustomer: RequestHandler;
  deleteCustomer: RequestHandler;
  ensureConsumidorFinalEndpoint: RequestHandler;
}

/**
 * Public (list) shape — NEVER includes PII columns. Used by `GET /customers`.
 *
 * Per SPEC-0031 §10, list responses are constrained to non-PII columns so a
 * tenant member with `customer.read` can browse the catalog without ever
 * being handed bulk PII. Detail responses (single id GET) include the PII
 * fields because the access pattern is deliberate.
 */
interface CustomerListResponse {
  id: string;
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  nombreComercial: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerDetailResponse extends CustomerListResponse {
  email: string | null;
  telefono: string | null;
  direccion: string | null;
}

function toListResponse(row: Customer): CustomerListResponse {
  return {
    id: row.id,
    tipoIdentificacion: row.tipoIdentificacion,
    identificacion: row.identificacion,
    razonSocial: row.razonSocial,
    nombreComercial: row.nombreComercial,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetailResponse(row: Customer): CustomerDetailResponse {
  return {
    ...toListResponse(row),
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
  };
}

export function buildCustomerHandlers(deps: CustomerHandlerDeps): CustomerHandlers {
  const { prisma, logger } = deps;

  /**
   * `GET /api/v1/customers?q=&tipoIdentificacion=&limit=&cursor=`.
   *
   * Search behaviour:
   *   - `q` is a free-form term. We apply a prefix match on `razonSocial`
   *     (case-insensitive) AND an exact match on `identificacion`, OR'd
   *     together. The `(companyId, razonSocial)` btree index handles the
   *     prefix; the `(companyId, identificacion)` index handles the exact.
   *
   * Cursor pagination uses the ULID `id` column (insertion-ordered).
   */
  const listCustomers: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const query = ListQuerySchema.parse(req.query);
      const limit = query.limit ?? 20;

      // Build the search predicate. Empty `q` → no filter (full list).
      const where: Prisma.CustomerWhereInput = {
        companyId,
        deletedAt: null,
        ...(query.tipoIdentificacion === undefined
          ? {}
          : { tipoIdentificacion: query.tipoIdentificacion }),
        ...(query.q === undefined
          ? {}
          : {
              // Prefix match on razonSocial (index-friendly): `startsWith`
              // compiles to `LOWER(...) LIKE LOWER('q%')` under Prisma's
              // `mode: "insensitive"` on Postgres.
              OR: [
                {
                  razonSocial: {
                    startsWith: query.q,
                    mode: "insensitive",
                  },
                },
                // Exact-equality match on identificacion; the
                // `(companyId, identificacion)` index covers it.
                { identificacion: query.q },
              ],
            }),
      };

      const rows = await prisma.customer.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1]?.id ?? null) : null;

      res.status(200).json({ items: items.map(toListResponse), nextCursor });
    } catch (err) {
      next(err);
    }
  };

  /**
   * `GET /api/v1/customers/:id` — detail (includes PII). 404 on cross-tenant
   * probes (same body shape as "not found" — no enumeration).
   */
  const getCustomer: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      const row = await prisma.customer.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (row === null) throw new NotFoundError("customer");
      res.status(200).json(toDetailResponse(row));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/customers` — create. RBAC: `customer.create`.
   */
  const createCustomer: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const body = validateCreate(req.body);

      const id = newId();
      let created: Customer;
      try {
        created = await prisma.customer.create({
          data: {
            id,
            companyId,
            tipoIdentificacion: body.tipoIdentificacion,
            identificacion: body.identificacion,
            razonSocial: body.razonSocial,
            nombreComercial: body.nombreComercial ?? null,
            email: body.email ?? null,
            telefono: body.telefono ?? null,
            direccion: body.direccion ?? null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictError(
            "Customer already exists for this tipoIdentificacion + identificacion",
            "customer.duplicate",
            { cause: err },
          );
        }
        throw err;
      }

      // Audit — payload deliberately omits all PII columns. We include only
      // the identifiers the operator needs to correlate (id, tipo). Email,
      // telefono, direccion never enter `payloadJson`.
      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "customer.created",
          entity: "Customer",
          entityId: created.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            tipoIdentificacion: created.tipoIdentificacion,
          },
        },
      );

      res.status(201).json(toDetailResponse(created));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/customers/:id` — update mutable fields. Cross-tenant
   * probes return 404. The body cannot change `tipoIdentificacion` or
   * `identificacion` (rejected upstream by `validateUpdate`).
   */
  const updateCustomer: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      const body = validateUpdate(req.body);

      const existing = await prisma.customer.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("customer");

      const updateData: Prisma.CustomerUpdateInput = {};
      if (body.razonSocial !== undefined) {
        updateData.razonSocial = body.razonSocial;
      }
      if (body.nombreComercial !== undefined) {
        updateData.nombreComercial = body.nombreComercial;
      }
      if (body.email !== undefined) updateData.email = body.email;
      if (body.telefono !== undefined) updateData.telefono = body.telefono;
      if (body.direccion !== undefined) updateData.direccion = body.direccion;

      // Defence-in-depth: editing the consumidor-final singleton row would
      // change its razonSocial/identification semantics. Reject early.
      if (existing.tipoIdentificacion === "07" && existing.identificacion === "9999999999999") {
        throw new ConflictError(
          "Consumidor Final row is immutable",
          "customer.consumidor_final_immutable",
        );
      }

      // Defence-in-depth: include `companyId` in the WHERE so an attacker
      // who forged a known `id` from another tenant cannot reach this
      // update path even if the upstream tenant check is bypassed.
      const updated = await prisma.customer.update({
        where: { id, companyId },
        data: updateData,
      });

      // Audit payload: list of changed field NAMES plus a `before`/`after`
      // snapshot of those fields (the redaction walker in audit() runs
      // on the way to the DB so PII like `email` / `telefono` is masked
      // automatically — both objects pass through `redactPayload`).
      const changedKeys = Object.keys(updateData);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of changedKeys) {
        before[k] = (existing as unknown as Record<string, unknown>)[k] ?? null;
        after[k] = (updated as unknown as Record<string, unknown>)[k] ?? null;
      }
      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "customer.updated",
          entity: "Customer",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            changed: changedKeys,
            before,
            after,
          },
        },
      );

      res.status(200).json(toDetailResponse(updated));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `DELETE /api/v1/customers/:id` — soft-delete only (sets `deletedAt`).
   * 204 on success.
   */
  const deleteCustomer: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const existing = await prisma.customer.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("customer");

      // Refuse to soft-delete the consumidor-final singleton — invoices
      // routinely default to it. Hiding it would break the orchestrator.
      if (existing.tipoIdentificacion === "07" && existing.identificacion === "9999999999999") {
        throw new ConflictError(
          "Consumidor Final row cannot be deleted",
          "customer.consumidor_final_immutable",
        );
      }

      // Defence-in-depth: `companyId` in the WHERE prevents cross-tenant
      // soft-deletes even if the prior `findFirst` guard is ever bypassed.
      await prisma.customer.update({
        where: { id, companyId },
        data: { deletedAt: new Date() },
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "customer.deleted",
          entity: "Customer",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { tipoIdentificacion: existing.tipoIdentificacion },
        },
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/customers/consumidor-final` — idempotent helper exposed
   * to the orchestrator + the web flow. Returns 200 with the persisted row
   * on every call. The same RBAC gate as reads (`customer.read`) because
   * this is effectively "I want to look up my Consumidor Final id".
   *
   * The body is empty (no parameters). Calling it 5 times leaves exactly
   * one row per tenant.
   */
  const ensureConsumidorFinalEndpoint: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      // The body should be empty; reject anything that looks like the
      // caller intended to override the literals.
      if (
        req.body !== undefined &&
        req.body !== null &&
        typeof req.body === "object" &&
        Object.keys(req.body as Record<string, unknown>).length > 0
      ) {
        throw new ValidationError("consumidor-final endpoint accepts no body parameters", {
          errors: [
            {
              identificador: "(body)",
              mensaje: "no body parameters accepted",
              tipo: "ERROR",
            },
          ],
        });
      }

      const row = await ensureConsumidorFinal(prisma, companyId);
      // We DON'T audit here — the helper is idempotent and called by the
      // orchestrator on every emission; logging a row per call would dwarf
      // real audit traffic. The first creation is captured by Prisma's
      // audit-trigger pattern (future work) or the orchestrator's own
      // invoice.created event referencing this row.
      res.status(200).json(toDetailResponse(row));
    } catch (err) {
      next(err);
    }
  };

  return {
    listCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    ensureConsumidorFinalEndpoint,
  };
}
