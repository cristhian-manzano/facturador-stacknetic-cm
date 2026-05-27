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

import { Router, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { RateLimitError } from "@facturador/utils/errors";

import { assertCsrf } from "../auth/csrf.js";
import { requirePermission } from "../auth/require-permission.js";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";
import { env } from "../env.js";

import { buildTenantHandlers } from "./handlers.js";

/**
 * Per-session rate limiter for tenant CRUD writes (30/min). The keyer
 * uses the session cookie value so a hostile actor cannot poison
 * another user's bucket by spoofing IPs. We fall back to `req.ip` when
 * no session cookie is present so anonymous probes still get throttled.
 *
 * The 30/min ceiling targets the human workflow (create / rename / add
 * member) — anything above that on a single session is almost certainly
 * scripted abuse.
 */
function buildTenantWriteRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: true, xForwardedForHeader: false },
    keyGenerator: (req: Request) => {
      const cookieJar = req.cookies as Record<string, string> | undefined;
      const sid = cookieJar?.facturador_session;
      if (typeof sid === "string" && sid.length > 0) return `tenant:sid:${sid}`;
      return `tenant:ip:${req.ip ?? "_no_ip_"}`;
    },
    handler: (_req, _res, next) => {
      next(new RateLimitError());
    },
  });
}

export interface TenantRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export function buildTenantRouter(deps: TenantRouterDeps): Router {
  const router: Router = Router();
  const handlers = buildTenantHandlers(deps);
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });
  // One limiter instance per router — shared across every mutating
  // tenant route (create + rename + member writes). The in-memory store
  // is per-process; v1 trade-off matches the auth rate limiter.
  const tenantWriteLimiter = buildTenantWriteRateLimiter();

  // -- Tenants list / create -------------------------------------------------
  // List does NOT require an active tenant: an authenticated user with no
  // memberships still needs to see the empty list. Create likewise: a
  // freshly-onboarded user with no tenant must be able to make one.
  router.get("/tenants", requireSession, handlers.listTenants);

  router.post("/tenants", requireSession, assertCsrf, tenantWriteLimiter, handlers.createTenant);

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
    tenantWriteLimiter,
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
    tenantWriteLimiter,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.addMember,
  );

  router.patch(
    "/tenants/:id/members/:userId",
    requireSession,
    assertCsrf,
    tenantWriteLimiter,
    requireTenant,
    requirePermission("tenant.manage_members"),
    handlers.updateMemberRole,
  );

  router.delete(
    "/tenants/:id/members/:userId",
    requireSession,
    assertCsrf,
    tenantWriteLimiter,
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
