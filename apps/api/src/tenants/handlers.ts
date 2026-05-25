/**
 * Tenant + membership + tenant-switch handlers.
 *
 * Source of truth:
 *   - SPEC-0011 §6.
 *   - TASKS-0011 §3.
 *   - PLAN-0011 §4 phase 3.
 *
 * Mount order in `tenants/routes.ts`:
 *   - List/Create tenants     → requireSession only.
 *   - Tenant switch           → requireSession + assertCsrf.
 *   - Update tenant           → requireSession + requireTenant +
 *                                requirePermission("tenant.update") + assertCsrf.
 *   - List/Add/Patch/Delete members
 *                              → requireSession + requireTenant +
 *                                requirePermission("tenant.manage_members") +
 *                                assertCsrf (for mutating verbs).
 *
 * All handlers are factory-built (`buildTenantHandlers({ prisma, logger })`)
 * to mirror the pattern in `auth/handlers.ts` — keeps tests injecting per-
 * schema Prisma + sink loggers without touching globals.
 *
 * Hard rules enforced:
 *   - companyId NEVER read from the request body for tenant-scoped routes.
 *     `req.companyId` (set by `requireTenant`) is the only source.
 *   - For the URL param `:id` on `/tenants/:id/...` we additionally assert
 *     it equals `req.companyId` so a member of T1 who guesses the URL of
 *     T2 still receives 403, never reading the other tenant.
 *   - Tenant switch rotates CSRF (server invalidates old token via the
 *     same row update — the integration tests exercise this).
 *   - Audit every state change: created/updated/switched/member added/
 *     role changed/removed.
 */

import type { Request, RequestHandler, Response } from "express";
import type { PrismaClient } from "@facturador/db";
import { AuthError, ForbiddenError, NotFoundError } from "@facturador/utils/errors";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import type { Logger } from "@facturador/logger";
import {
  AddMemberSchema,
  CreateTenantSchema,
  MemberListItemSchema,
  MembershipSummarySchema,
  TenantSchema,
  UpdateMemberRoleSchema,
  UpdateTenantSchema,
} from "@facturador/contracts/tenants";
import { SessionTenantSwitchSchema } from "@facturador/contracts/auth";
import { z } from "zod";
import { setSessionCookies } from "../auth/cookies.js";
import { switchSessionTenant } from "../auth/session-store.js";
import {
  addMember as addMemberSvc,
  changeMemberRole,
  createTenantWithOwner,
  removeMember as removeMemberSvc,
  updateTenant as updateTenantSvc,
} from "./tenant-service.js";

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

export interface TenantHandlerDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export interface TenantHandlers {
  listTenants: RequestHandler;
  createTenant: RequestHandler;
  switchTenant: RequestHandler;
  updateTenant: RequestHandler;
  listMembers: RequestHandler;
  addMember: RequestHandler;
  updateMemberRole: RequestHandler;
  removeMember: RequestHandler;
}

const TenantIdParam = z.object({ id: z.string().min(1) });
const MemberIdParams = z.object({ id: z.string().min(1), userId: z.string().min(1) });

export function buildTenantHandlers(deps: TenantHandlerDeps): TenantHandlers {
  const { prisma, logger } = deps;

  /**
   * `GET /api/v1/tenants` — list tenants the caller is a member of.
   * Returns `MembershipSummarySchema[]` (companyId, razonSocial, role).
   *
   * Per TASKS-0011 hard rule, the body never reveals tenants the caller
   * is NOT a member of.
   */
  const listTenants: RequestHandler = async (req: Request, res: Response, next) => {
    try {
      const user = req.user;
      if (user === undefined) throw new AuthError();
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      });
      const body = memberships.map((m) => ({
        companyId: m.companyId,
        razonSocial: m.company.razonSocial,
        role: m.role,
      }));
      // Validate the body shape so any drift fails loud.
      const parsed = z.array(MembershipSummarySchema).parse(body);
      res.status(200).json(parsed);
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/tenants` — create a new tenant; caller becomes OWNER.
   */
  const createTenant: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      if (user === undefined) throw new AuthError();
      const input = CreateTenantSchema.parse(req.body);

      const { companyId, membershipId } = await createTenantWithOwner(prisma, user.id, {
        ruc: input.ruc as unknown as string,
        razonSocial: input.razonSocial,
        nombreComercial: input.nombreComercial ?? null,
        direccionMatriz: input.direccionMatriz,
        ambiente: input.ambiente,
        contribuyenteEspecial: input.contribuyenteEspecial ?? null,
        obligadoContabilidad: input.obligadoContabilidad,
      });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.created",
          entity: "Company",
          entityId: companyId,
          actorUserId: user.id,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { membershipId, role: "OWNER" },
        },
      );

      const created = await prisma.company.findUnique({ where: { id: companyId } });
      if (created === null) throw new NotFoundError("tenant");
      const body = TenantSchema.parse({
        id: created.id,
        ruc: created.ruc,
        razonSocial: created.razonSocial,
        nombreComercial: created.nombreComercial,
        direccionMatriz: created.direccionMatriz,
        ambiente: created.ambiente,
        contribuyenteEspecial: created.contribuyenteEspecial,
        obligadoContabilidad: created.obligadoContabilidad,
        contribuyenteRimpe: null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/session/tenant` — switch active tenant + rotate CSRF.
   *
   * Hard rule: CSRF rotates on tenant switch (TASKS-0011 §3.3).
   *
   * The previous CSRF token is invalidated because we overwrite
   * `csrfTokenHash` on the session row; subsequent mutating requests with
   * the stale value fail because `assertCsrf` recomputes the SHA-256
   * digest of the cookie value and compares to the new hash.
   */
  const switchTenant: RequestHandler = async (req, res, next) => {
    try {
      const session = req.session;
      const user = req.user;
      if (session === undefined || user === undefined) throw new AuthError();

      const { companyId } = SessionTenantSwitchSchema.parse(req.body);

      // Verify membership. Same generic 403 body whether the tenant doesn't
      // exist or the user isn't a member — no enumeration oracle.
      const membership = await prisma.membership.findUnique({
        where: { userId_companyId: { userId: user.id, companyId } },
      });
      if (membership === null) {
        throw new ForbiddenError("Not a member of target tenant", "no_membership");
      }

      const { csrfToken } = await switchSessionTenant(prisma, session.id, companyId);

      // Re-set both cookies. The session cookie value didn't change, but
      // refreshing it keeps the attribute matrix consistent + cleanly
      // signals the new CSRF token to the client.
      setSessionCookies(res, { sessionId: session.id, csrfToken });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.switch",
          entity: "Session",
          entityId: session.id,
          actorUserId: user.id,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { from: session.companyId, to: companyId },
        },
      );

      res.status(200).json({
        companyId,
        role: membership.role,
        csrfToken,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/tenants/:id` — update mutable tenant fields.
   *
   * The URL param `:id` MUST equal `req.companyId` (server-side). Otherwise
   * we reject 403 — never read or write a tenant outside the caller's
   * active session.
   */
  const updateTenantHandler: RequestHandler = async (req, res, next) => {
    try {
      const { id } = TenantIdParam.parse(req.params);
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      if (id !== companyId) {
        throw new ForbiddenError("Cross-tenant request denied", "no_membership");
      }
      const body = UpdateTenantSchema.parse(req.body);

      // Build a clean update payload (only defined keys).
      const update: Record<string, unknown> = {};
      if (body.razonSocial !== undefined) update.razonSocial = body.razonSocial;
      if (body.nombreComercial !== undefined) update.nombreComercial = body.nombreComercial;
      if (body.direccionMatriz !== undefined) update.direccionMatriz = body.direccionMatriz;
      if (body.contribuyenteEspecial !== undefined) {
        update.contribuyenteEspecial = body.contribuyenteEspecial;
      }
      if (body.obligadoContabilidad !== undefined) {
        update.obligadoContabilidad = body.obligadoContabilidad;
      }
      await updateTenantSvc(prisma, companyId, update);

      const user = req.user;
      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.updated",
          entity: "Company",
          entityId: companyId,
          actorUserId: user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { changed: Object.keys(update) },
        },
      );

      const fresh = await prisma.company.findUnique({ where: { id: companyId } });
      if (fresh === null) throw new NotFoundError("tenant");
      const tenant = TenantSchema.parse({
        id: fresh.id,
        ruc: fresh.ruc,
        razonSocial: fresh.razonSocial,
        nombreComercial: fresh.nombreComercial,
        direccionMatriz: fresh.direccionMatriz,
        ambiente: fresh.ambiente,
        contribuyenteEspecial: fresh.contribuyenteEspecial,
        obligadoContabilidad: fresh.obligadoContabilidad,
        contribuyenteRimpe: null,
        createdAt: fresh.createdAt.toISOString(),
        updatedAt: fresh.updatedAt.toISOString(),
      });
      res.status(200).json(tenant);
    } catch (err) {
      next(err);
    }
  };

  /**
   * `GET /api/v1/tenants/:id/members` — list members. Requires
   * `tenant.manage_members` and that `:id` equals `req.companyId`.
   */
  const listMembers: RequestHandler = async (req, res, next) => {
    try {
      const { id } = TenantIdParam.parse(req.params);
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      if (id !== companyId) {
        throw new ForbiddenError("Cross-tenant request denied", "no_membership");
      }
      const rows = await prisma.membership.findMany({
        where: { companyId },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      const body = rows.map((row) => ({
        userId: row.userId,
        email: row.user.email,
        displayName: row.user.displayName,
        role: row.role,
      }));
      const parsed = z.array(MemberListItemSchema).parse(body);
      res.status(200).json(parsed);
    } catch (err) {
      next(err);
    }
  };

  /**
   * `POST /api/v1/tenants/:id/members` — add a member (direct attach;
   * email-based invitations are a later spec).
   */
  const addMemberHandler: RequestHandler = async (req, res, next) => {
    try {
      const { id } = TenantIdParam.parse(req.params);
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      if (id !== companyId) {
        throw new ForbiddenError("Cross-tenant request denied", "no_membership");
      }
      const body = AddMemberSchema.parse(req.body);
      const { membershipId } = await addMemberSvc(
        prisma,
        companyId,
        body.userId as unknown as string,
        body.role,
      );

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.member.added",
          entity: "Membership",
          entityId: membershipId,
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            targetUserId: body.userId,
            role: body.role,
          },
        },
      );
      res.status(201).json({
        membershipId,
        userId: body.userId,
        role: body.role,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * `PATCH /api/v1/tenants/:id/members/:userId` — change a member's role.
   * Last-OWNER guard is enforced in the service inside a transaction.
   */
  const updateMemberRoleHandler: RequestHandler = async (req, res, next) => {
    try {
      const { id, userId } = MemberIdParams.parse(req.params);
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      if (id !== companyId) {
        throw new ForbiddenError("Cross-tenant request denied", "no_membership");
      }
      const { role: newRole } = UpdateMemberRoleSchema.parse(req.body);

      const { previousRole } = await changeMemberRole(prisma, companyId, userId, newRole);

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.member.role_changed",
          entity: "Membership",
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            targetUserId: userId,
            from: previousRole,
            to: newRole,
          },
        },
      );

      res.status(200).json({
        userId,
        previousRole,
        role: newRole,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * `DELETE /api/v1/tenants/:id/members/:userId` — remove a member.
   * Last-OWNER guard applies here too.
   */
  const removeMemberHandler: RequestHandler = async (req, res, next) => {
    try {
      const { id, userId } = MemberIdParams.parse(req.params);
      const companyId = req.companyId;
      if (companyId === undefined) throw new AuthError();
      if (id !== companyId) {
        throw new ForbiddenError("Cross-tenant request denied", "no_membership");
      }
      const { previousRole } = await removeMemberSvc(prisma, companyId, userId);

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "tenant.member.removed",
          entity: "Membership",
          actorUserId: req.user?.id ?? null,
          companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: {
            targetUserId: userId,
            previousRole,
          },
        },
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  return {
    listTenants,
    createTenant,
    switchTenant,
    updateTenant: updateTenantHandler,
    listMembers,
    addMember: addMemberHandler,
    updateMemberRole: updateMemberRoleHandler,
    removeMember: removeMemberHandler,
  };
}
