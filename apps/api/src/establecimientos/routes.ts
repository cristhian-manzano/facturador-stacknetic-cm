/**
 * Establecimientos + emission-points router — mounts SPEC-0030 endpoints
 * under `/api/v1`.
 *
 * Mount table:
 *
 *   GET    /api/v1/establecimientos                       requireSession+requireTenant
 *   POST   /api/v1/establecimientos                       + CSRF + establecimiento.manage
 *   PATCH  /api/v1/establecimientos/:id                   + CSRF + establecimiento.manage
 *   DELETE /api/v1/establecimientos/:id                   + CSRF + establecimiento.manage
 *   GET    /api/v1/establecimientos/:id/emission-points   requireSession+requireTenant
 *   POST   /api/v1/establecimientos/:id/emission-points   + CSRF + establecimiento.manage
 *   PATCH  /api/v1/emission-points/:id                    + CSRF + establecimiento.manage
 *   DELETE /api/v1/emission-points/:id                    + CSRF + establecimiento.manage
 *
 * Every route requires an authenticated session AND an active tenant
 * (`requireTenant` populates `req.companyId`). The mutating verbs add CSRF
 * (`assertCsrf`) and the `establecimiento.manage` permission per the RBAC
 * matrix (OWNER/ADMIN only).
 */
import { Router } from "express";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

import { assertCsrf } from "../auth/csrf.js";
import { requirePermission } from "../auth/require-permission.js";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";

import { buildEstablecimientoHandlers } from "./handlers.js";

export interface EstablecimientoRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export function buildEstablecimientoRouter(deps: EstablecimientoRouterDeps): Router {
  const router: Router = Router();
  const handlers = buildEstablecimientoHandlers(deps);
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });

  // -- Establecimientos -----------------------------------------------------
  router.get("/establecimientos", requireSession, requireTenant, handlers.listEstablecimientos);

  router.post(
    "/establecimientos",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.createEstablecimiento,
  );

  router.patch(
    "/establecimientos/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.updateEstablecimiento,
  );

  router.delete(
    "/establecimientos/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.deleteEstablecimiento,
  );

  // -- Emission points (nested under establecimiento) -----------------------
  router.get(
    "/establecimientos/:id/emission-points",
    requireSession,
    requireTenant,
    handlers.listEmissionPoints,
  );

  router.post(
    "/establecimientos/:id/emission-points",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.createEmissionPoint,
  );

  // -- Emission points (top-level addressable) ------------------------------
  // `PATCH` and `DELETE` address the emission point by its own id; the
  // server still scopes by `req.companyId` so cross-tenant probes 404.
  router.patch(
    "/emission-points/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.updateEmissionPoint,
  );

  router.delete(
    "/emission-points/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("establecimiento.manage"),
    handlers.deleteEmissionPoint,
  );

  return router;
}
