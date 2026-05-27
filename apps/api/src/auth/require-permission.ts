/**
 * `requirePermission(action)` — RBAC route gate.
 *
 * Source of truth:
 *   - SPEC-0011 §6.4.
 *   - PLAN-0011 §4 (Phase 2).
 *   - TASKS-0011 §2.2.
 *
 * Mount order on tenant-scoped routes:
 *
 *     requireSession → requireTenant → requirePermission(action) → handler
 *
 * The middleware reads `req.role` (populated by `requireTenant`) and calls
 * the pure `can(role, action)` predicate from `@facturador/utils/rbac`. On
 * deny, throws `ForbiddenError("Forbidden", "forbidden_action")` so the
 * terminal error middleware renders a 403 / ProblemDetail with a stable
 * code clients can switch on.
 *
 * Notes:
 *   - No string interpolation in the rejection message — every denied
 *     request gets the SAME body, distinguished only by `instance`
 *     (request id). This prevents leaking which permissions a user lacks
 *     for which tenants. The action argument is captured at registration
 *     time so it never appears in the response.
 *   - `requirePermission` never reaches the DB; it is O(1) over the matrix
 *     lookup. The "lookup is hot path" risk is in `requireTenant`, not here.
 */

import type { RequestHandler } from "express";

import { ForbiddenError } from "@facturador/utils/errors";
import { can, type Action } from "@facturador/utils/rbac";

import { env } from "../env.js";

/**
 * Server-side overrides on top of the pure RBAC matrix. The matrix in
 * `@facturador/utils/rbac` is OWNER-only for `tenant.update`; setting
 * `RBAC_ADMIN_CAN_UPDATE_TENANT=true` flips that one bit for ADMIN.
 *
 * Similarly, the matrix is view-only for ACCOUNTANT
 * (SPEC-0011 §FR-5 row 3); operators who relied on the legacy
 * write-capable behaviour can set `RBAC_ACCOUNTANT_CAN_WRITE=true` to
 * restore `customer.create/update` and `invoice.create/emit/reissue`
 * for ACCOUNTANT.
 *
 * We do NOT push these overrides into `@facturador/utils/rbac` so the
 * matrix stays pure (no env / no I/O) — the SPA imports the same matrix
 * and must not depend on the server's runtime env. UIs that want ADMIN
 * to see the "Rename tenant" button anyway can read the same env flag
 * through the auth `/me` endpoint (future work).
 */
const ACCOUNTANT_WRITE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "customer.create",
  "customer.update",
  "invoice.create",
  "invoice.emit",
  "invoice.reissue",
]);

function isAllowedByOverride(role: string, action: Action): boolean {
  if (action === "tenant.update" && env.RBAC_ADMIN_CAN_UPDATE_TENANT && role === "ADMIN") {
    return true;
  }
  if (
    role === "ACCOUNTANT" &&
    env.RBAC_ACCOUNTANT_CAN_WRITE &&
    ACCOUNTANT_WRITE_ACTIONS.has(action)
  ) {
    return true;
  }
  return false;
}

export function requirePermission(action: Action): RequestHandler {
  return function requirePermissionMw(req, _res, next) {
    const role = req.role;
    if (role === undefined) {
      // `requireTenant` should have populated this. If it didn't, the route
      // is misconfigured; we fail closed with 403 rather than 500 because
      // the user-visible outcome is "denied" and we never leak the cause.
      next(new ForbiddenError("Forbidden", "forbidden_action"));
      return;
    }
    if (!can(role, action) && !isAllowedByOverride(role, action)) {
      next(new ForbiddenError("Forbidden", "forbidden_action"));
      return;
    }
    next();
  };
}
