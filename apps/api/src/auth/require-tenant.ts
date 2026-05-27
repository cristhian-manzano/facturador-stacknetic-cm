/**
 * `requireTenant` middleware.
 *
 * Source of truth:
 *   - SPEC-0011 §6.3.
 *   - PLAN-0011 §4 (Phase 2).
 *   - TASKS-0011 §2.1.
 *   - ai/context/security.md ("companyId must never come from the client").
 *
 * Responsibilities:
 *   1. Read `req.session.companyId`. If null/undefined, throw a
 *      `PreconditionRequiredError` (412, `code: "tenant_not_selected"`).
 *   2. Re-load the Membership row from the DB for `{ userId, companyId }`.
 *      We deliberately re-load on every request (no per-request cache yet)
 *      so a user whose membership was revoked mid-session is rejected on
 *      their next request without waiting for the session to expire. The
 *      review file lists this as a documented performance risk for a later
 *      cache layer.
 *   3. If no membership exists → 403 `code: "no_membership"`. The response
 *      body does NOT distinguish "tenant doesn't exist" from "user not a
 *      member": both produce the same generic 403 body so an attacker
 *      cannot enumerate existing tenants via a probing pattern (see
 *      TASKS-0011 hard rules).
 *   4. Attach `req.companyId`, `req.role`, `req.membership` for downstream
 *      handlers + `requirePermission`.
 *
 * The middleware never reads `companyId` from `req.body`, `req.query`,
 * `req.params`, or any header. The ONLY source is `req.session.companyId`
 * — which itself was server-side persisted on tenant switch.
 */

import type { Request, RequestHandler } from "express";

import type { PrismaClient } from "@facturador/db";
import { ForbiddenError, PreconditionRequiredError } from "@facturador/utils/errors";
import type { Role } from "@facturador/utils/rbac";

/**
 * Active membership shape attached to `req.membership`.
 *
 * We project to a narrow surface (id, userId, companyId, role) so downstream
 * handlers don't accidentally read columns that might leak across tenants
 * (e.g. created/updated timestamps from other tenants' members).
 */
export interface ActiveMembership {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly role: Role;
}

export interface RequireTenantDeps {
  prisma: PrismaClient;
}

export function buildRequireTenant(deps: RequireTenantDeps): RequestHandler {
  const { prisma } = deps;

  return async function requireTenant(req: Request, _res, next) {
    try {
      const session = req.session;
      if (session === undefined) {
        // `requireSession` should have thrown 401 already. Defensive
        // fallback: a route that mounts `requireTenant` without
        // `requireSession` first is misconfigured; 412 is safe because the
        // client cannot satisfy the precondition without a session.
        throw new PreconditionRequiredError();
      }

      const companyId = session.companyId;
      if (companyId === null) {
        throw new PreconditionRequiredError();
      }

      // Re-load on every request (security trade-off documented above).
      // The unique lookup returns any matching membership, but we also
      // require `acceptedAt IS NOT NULL` so an unaccepted invitation
      // cannot be selected as the active tenant. We use `findFirst`
      // with the additional predicate instead of `findUnique` because
      // the `userId_companyId` composite is enough to guarantee at most
      // one row regardless of the acceptance state.
      const row = await prisma.membership.findFirst({
        where: {
          userId: session.userId,
          companyId,
          acceptedAt: { not: null },
        },
      });

      if (row === null) {
        // Generic 403. We MUST NOT include the companyId or any hint that
        // the tenant exists in the response body — that's a tenant
        // enumeration oracle. The error handler will render a stable
        // ProblemDetail; the message is short and tenant-agnostic.
        throw new ForbiddenError("Not a member of active tenant", "no_membership");
      }

      const membership: ActiveMembership = {
        id: row.id,
        userId: row.userId,
        companyId: row.companyId,
        role: row.role as Role,
      };

      req.membership = membership;
      req.role = membership.role;
      req.companyId = membership.companyId;
      next();
    } catch (err) {
      next(err);
    }
  };
}
