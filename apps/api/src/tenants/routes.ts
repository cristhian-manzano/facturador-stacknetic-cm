/**
 * Tenants router — wires SPEC-0011 endpoints under `/api/v1`.
 *
 * Mount table (every route except `/tenants` list/create + tenant switch
 * goes through `requireTenant` + `requirePermission`):
 *
 *   GET    /api/v1/tenants                       — requireSession.
 *   POST   /api/v1/tenants                       — requireSession + assertCsrf.
 *   POST   /api/v1/session/tenant                — requireSession + assertCsrf.
 *   PATCH  /api/v1/tenants/:id                   — full chain + tenant.update.
 *   GET    /api/v1/tenants/:id/members           — full chain + tenant.manage_members.
 *   POST   /api/v1/tenants/:id/members           — full chain + tenant.manage_members.
 *   PATCH  /api/v1/tenants/:id/members/:userId   — full chain + tenant.manage_members.
 *   DELETE /api/v1/tenants/:id/members/:userId   — full chain + tenant.manage_members.
 *   POST   /api/v1/_diag/perm-check              — requirePermission stub (test-only).
 *
 * Routes are mounted in `server.ts` AFTER the auth router (which provides
 * `requireSession`); we receive the requireSession factory output so this
 * module stays unit-testable.
 */

import { Router } from "express";
import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";
import { requirePermission } from "../auth/require-permission.js";
import { assertCsrf } from "../auth/csrf.js";
import { env } from "../env.js";
import { buildTenantHandlers } from "./handlers.js";

export interface TenantRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export function buildTenantRouter(deps: TenantRouterDeps): Router {
  const router: Router = Router();
  const handlers = buildTenantHandlers(deps);
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });

  // -- Tenants list / create -------------------------------------------------
  // List does NOT require an active tenant: an authenticated user with no
  // memberships still needs to see the empty list. Create likewise: a
  // freshly-onboarded user with no tenant must be able to make one.
  router.get("/tenants", requireSession, handlers.listTenants);

  router.post("/tenants", requireSession, assertCsrf, handlers.createTenant);

  // -- Tenant switch ---------------------------------------------------------
  // Requires an authenticated session + CSRF (this is a state-changing verb).
  // Does NOT require an active tenant (you're picking one!). Rotates CSRF
  // inside `switchSessionTenant`.
  router.post("/session/tenant", requireSession, assertCsrf, handlers.switchTenant);

  // -- Tenant update ---------------------------------------------------------
  router.patch(
    "/tenants/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("tenant.update"),
    handlers.updateTenant,
  );

  // -- Member management ----------------------------------------------------
  // List members (safe — no CSRF needed).
  router.get(
    "/tenants/:id/members",
    requireSession,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.listMembers,
  );

  router.post(
    "/tenants/:id/members",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.addMember,
  );

  router.patch(
    "/tenants/:id/members/:userId",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.updateMemberRole,
  );

  router.delete(
    "/tenants/:id/members/:userId",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.removeMember,
  );

  // -- Diagnostic permission probe (non-production only) --------------------
  // Used by integration tests + the cross-tenant `?companyId=other` probe.
  // Returns the active companyId from the SESSION ROW (never the query) so
  // tests can assert that the query param is ignored. A real domain route
  // would gate by `requirePermission("customer.read")` etc.; we use
  // `invoice.read` here because every role can do that.
  if (env.NODE_ENV !== "production") {
    router.get(
      "/_diag/tenant-context",
      requireSession,
      requireTenant,
      requirePermission("invoice.read"),
      (req, res) => {
        res.status(200).json({
          companyId: req.companyId,
          role: req.role,
        });
      },
    );

    // Permission probe that requires `invoice.create` — VIEWER hits 403,
    // OPERATOR passes (per the matrix). Used by the integration test for
    // the RBAC matrix × privileged-action coverage.
    router.post(
      "/_diag/perm-check",
      requireSession,
      assertCsrf,
      requireTenant,
      requirePermission("invoice.create"),
      (_req, res) => {
        res.status(204).send();
      },
    );
  }

  return router;
}
