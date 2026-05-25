/**
 * Establecimiento + emission-point CRUD handlers.
 *
 * Source of truth:
 *   - SPEC-0030 §FR-2 + §6.3.
 *   - PLAN-0030 §4 Phase 3.
 *   - TASKS-0030 §4.
 *
 * Mount table (in `routes.ts`):
 *   GET    /api/v1/establecimientos
 *   POST   /api/v1/establecimientos                       establecimiento.manage
 *   PATCH  /api/v1/establecimientos/:id                   establecimiento.manage
 *   DELETE /api/v1/establecimientos/:id                   establecimiento.manage
 *   GET    /api/v1/establecimientos/:id/emission-points
 *   POST   /api/v1/establecimientos/:id/emission-points   establecimiento.manage
 *   PATCH  /api/v1/emission-points/:id                    establecimiento.manage
 *   DELETE /api/v1/emission-points/:id                    establecimiento.manage
 *
 * Hard rules enforced:
 *   - `companyId` ALWAYS from `req.companyId` (populated by `requireTenant`).
 *     The Zod schemas reject extra keys via `.strict()` so a body that tries
 *     to inject one fails validation before the handler runs — but even if
 *     it slipped through, the handler ignores body fields by name.
 *   - Soft-delete only: handlers set `deletedAt` and read filters always
 *     exclude `deletedAt IS NOT NULL`.
 *   - Cross-tenant probes return 404 (the same shape as "not found") to
 *     prevent enumeration. We never differentiate between "not yours" and
 *     "does not exist".
 *   - `isDefault: true` toggles run inside a transaction; sibling rows are
 *     flipped off so the at-most-one-default invariant holds.
 *   - Audit every mutation: created / updated / deleted.
 */
import type { Request, RequestHandler } from "express";
import { ulid } from "ulid";
import { Prisma } from "@facturador/db";
import type { PrismaClient } from "@facturador/db";
import { AuthError, ConflictError, NotFoundError } from "@facturador/utils/errors";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import type { Logger } from "@facturador/logger";
import { z } from "zod";
import {
  CreateEmissionPointSchema,
  CreateEstablecimientoSchema,
  UpdateEmissionPointSchema,
  UpdateEstablecimientoSchema,
} from "./schemas.js";

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

export interface EstablecimientoHandlerDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export interface EstablecimientoHandlers {
  listEstablecimientos: RequestHandler;
  createEstablecimiento: RequestHandler;
  updateEstablecimiento: RequestHandler;
  deleteEstablecimiento: RequestHandler;
  listEmissionPoints: RequestHandler;
  createEmissionPoint: RequestHandler;
  updateEmissionPoint: RequestHandler;
  deleteEmissionPoint: RequestHandler;
}

interface EstablecimientoResponse {
  id: string;
  codigo: string;
  direccion: string;
  isMatriz: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EmissionPointResponse {
  id: string;
  establecimientoId: string;
  codigo: string;
  descripcion: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EstablecimientoRow {
  id: string;
  codigo: string;
  direccion: string;
  isMatriz: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface EmissionPointRow {
  id: string;
  establecimientoId: string;
  codigo: string;
  descripcion: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toEstablecimientoResponse(row: EstablecimientoRow): EstablecimientoResponse {
  return {
    id: row.id,
    codigo: row.codigo,
    direccion: row.direccion,
    isMatriz: row.isMatriz,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEmissionPointResponse(row: EmissionPointRow): EmissionPointResponse {
  return {
    id: row.id,
    establecimientoId: row.establecimientoId,
    codigo: row.codigo,
    descripcion: row.descripcion,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildEstablecimientoHandlers(
  deps: EstablecimientoHandlerDeps,
): EstablecimientoHandlers {
  const { prisma, logger } = deps;

  /**
   * `GET /api/v1/establecimientos` — list non-deleted establecimientos for
   * the active tenant. Open to every tenant member (no permission gate);
   * the routes file may still wrap it in `requireSession + requireTenant`.
   */
  const listEstablecimientos: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const rows = await prisma.establecimiento.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { codigo: "asc" },
      });
      res.status(200).json(rows.map(toEstablecimientoResponse));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/establecimientos` — create. RBAC: `establecimiento.manage`.
   */
  const createEstablecimiento: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const body = CreateEstablecimientoSchema.parse(req.body);

      const id = ulid();
      let created: EstablecimientoRow;
      try {
        created = await prisma.establecimiento.create({
          data: {
            id,
            companyId,
            codigo: body.codigo,
            direccion: body.direccion,
            isMatriz: body.isMatriz ?? false,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictError(
            "Establecimiento codigo already exists",
            "establecimiento.duplicate_codigo",
            { cause: err },
          );
        }
        throw err;
      }

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "establecimiento.created",
          entity: "Establecimiento",
          entityId: created.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { codigo: created.codigo, isMatriz: created.isMatriz },
        },
      );

      res.status(201).json(toEstablecimientoResponse(created));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/establecimientos/:id` — update mutable fields. Cross-
   * tenant lookups return 404.
   */
  const updateEstablecimiento: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      const body = UpdateEstablecimientoSchema.parse(req.body);

      const existing = await prisma.establecimiento.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("establecimiento");

      const updateData: { direccion?: string; isMatriz?: boolean } = {};
      if (body.direccion !== undefined) updateData.direccion = body.direccion;
      if (body.isMatriz !== undefined) updateData.isMatriz = body.isMatriz;

      const updated = await prisma.establecimiento.update({
        where: { id },
        data: updateData,
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "establecimiento.updated",
          entity: "Establecimiento",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { changed: Object.keys(updateData) },
        },
      );

      res.status(200).json(toEstablecimientoResponse(updated));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `DELETE /api/v1/establecimientos/:id` — soft-delete only. The row's
   * `deletedAt` is set; counters and burned-secuencial history persist so
   * the no-reuse rule survives a future resurrection.
   */
  const deleteEstablecimiento: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const existing = await prisma.establecimiento.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("establecimiento");

      await prisma.establecimiento.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "establecimiento.deleted",
          entity: "Establecimiento",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { codigo: existing.codigo },
        },
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  /**
   * `GET /api/v1/establecimientos/:id/emission-points` — list emission
   * points for an establecimiento (scoped to tenant).
   */
  const listEmissionPoints: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const est = await prisma.establecimiento.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (est === null) throw new NotFoundError("establecimiento");

      const rows = await prisma.emissionPoint.findMany({
        where: { establecimientoId: id, companyId, deletedAt: null },
        orderBy: { codigo: "asc" },
      });
      res.status(200).json(rows.map(toEmissionPointResponse));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/establecimientos/:id/emission-points` — create an
   * emission point. If `isDefault: true`, all sibling emission points are
   * flipped off in a single transaction.
   */
  const createEmissionPoint: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id: establecimientoId } = IdParam.parse(req.params);
      const body = CreateEmissionPointSchema.parse(req.body);

      // Verify the establecimiento exists for this tenant. A cross-tenant
      // probe lands here with a 404, same as a missing id — no enumeration
      // oracle.
      const est = await prisma.establecimiento.findFirst({
        where: { id: establecimientoId, companyId, deletedAt: null },
      });
      if (est === null) throw new NotFoundError("establecimiento");

      const id = ulid();
      let created: EmissionPointRow;
      try {
        created = await prisma.$transaction(async (tx) => {
          if (body.isDefault === true) {
            // Flip every active sibling off before inserting the new row.
            await tx.emissionPoint.updateMany({
              where: { establecimientoId, deletedAt: null, isDefault: true },
              data: { isDefault: false },
            });
          }
          return tx.emissionPoint.create({
            data: {
              id,
              companyId,
              establecimientoId,
              codigo: body.codigo,
              descripcion: body.descripcion,
              isDefault: body.isDefault ?? false,
            },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictError(
            "Emission point codigo already exists for this establecimiento",
            "emission_point.duplicate_codigo",
            { cause: err },
          );
        }
        throw err;
      }

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "emission_point.created",
          entity: "EmissionPoint",
          entityId: created.id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            establecimientoId,
            codigo: created.codigo,
            isDefault: created.isDefault,
          },
        },
      );

      res.status(201).json(toEmissionPointResponse(created));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/emission-points/:id` — update mutable fields. Toggling
   * `isDefault: true` flips siblings off inside a transaction.
   */
  const updateEmissionPoint: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);
      const body = UpdateEmissionPointSchema.parse(req.body);

      const existing = await prisma.emissionPoint.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("emission_point");

      const updateData: { descripcion?: string; isDefault?: boolean } = {};
      if (body.descripcion !== undefined) {
        updateData.descripcion = body.descripcion;
      }
      if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;

      const updated = await prisma.$transaction(async (tx) => {
        if (body.isDefault === true) {
          await tx.emissionPoint.updateMany({
            where: {
              establecimientoId: existing.establecimientoId,
              deletedAt: null,
              isDefault: true,
              id: { not: id },
            },
            data: { isDefault: false },
          });
        }
        return tx.emissionPoint.update({ where: { id }, data: updateData });
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "emission_point.updated",
          entity: "EmissionPoint",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { changed: Object.keys(updateData) },
        },
      );

      res.status(200).json(toEmissionPointResponse(updated));
    } catch (err) {
      next(err);
    }
  };

  /**
   * `DELETE /api/v1/emission-points/:id` — soft-delete only.
   */
  const deleteEmissionPoint: RequestHandler = async (req, res, next) => {
    try {
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      const { id } = IdParam.parse(req.params);

      const existing = await prisma.emissionPoint.findFirst({
        where: { id, companyId, deletedAt: null },
      });
      if (existing === null) throw new NotFoundError("emission_point");

      await prisma.emissionPoint.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "emission_point.deleted",
          entity: "EmissionPoint",
          entityId: id,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { codigo: existing.codigo },
        },
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  return {
    listEstablecimientos,
    createEstablecimiento,
    updateEstablecimiento,
    deleteEstablecimiento,
    listEmissionPoints,
    createEmissionPoint,
    updateEmissionPoint,
    deleteEmissionPoint,
  };
}

// Helper exposed for use by sequencing routes / orchestrator (later):
//   getEmissionPointForReservation(prisma, { companyId, establecimientoId })
// returns the EmissionPoint marked `isDefault: true`, or null if none.
//
// Defined here (rather than in `sequencing/`) because it deals with the
// emission-point CRUD surface, not the secuencial counter.
export async function getDefaultEmissionPoint(
  prisma: PrismaClient,
  args: { companyId: string; establecimientoId: string },
): Promise<EmissionPointRow | null> {
  return prisma.emissionPoint.findFirst({
    where: {
      companyId: args.companyId,
      establecimientoId: args.establecimientoId,
      isDefault: true,
      deletedAt: null,
    },
  });
}
