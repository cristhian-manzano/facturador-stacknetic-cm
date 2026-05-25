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
    if (!can(role, action)) {
      next(new ForbiddenError("Forbidden", "forbidden_action"));
      return;
    }
    next();
  };
}
