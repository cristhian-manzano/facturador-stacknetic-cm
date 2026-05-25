/**
 * Express request augmentation for apps/api.
 *
 * Adds the `req.id` (ULID set by `requestIdMiddleware`), `req.log`
 * (child Pino logger set by the request-logger middleware), `req.session`
 * (resolved Session row + computed CSRF hash, set by `requireSession`),
 * and `req.user` (the owning User row, set by the same middleware).
 *
 * SPEC-0011 adds three tenant-scoped fields populated by `requireTenant`:
 *   - `req.companyId` — active tenant id (DERIVED FROM SESSION, never from the
 *     client). Treat this as the SOLE source of truth for tenant scoping in
 *     business queries — see ai/context/security.md.
 *   - `req.role` — caller's role on the active tenant. Used by
 *     `requirePermission`.
 *   - `req.membership` — full membership row for richer audit metadata.
 *
 * Note: `req.cookies` is supplied by `cookie-parser` (its own ambient
 * declaration). We don't redeclare it here.
 */
import type { Logger } from "@facturador/logger";
import type { Role } from "@facturador/utils/rbac";
import type { AuthenticatedSession, AuthenticatedUser } from "../auth/types.js";
import type { ActiveMembership } from "../auth/require-tenant.js";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      log?: Logger;
      /** Resolved session row. Populated by `requireSession` middleware. */
      session?: AuthenticatedSession;
      /** Resolved user row. Populated by `requireSession` middleware. */
      user?: AuthenticatedUser;
      /**
       * Active tenant id, ALWAYS taken from the server-side session row.
       * Populated by `requireTenant`. The client cannot influence this value
       * (no body / query / header path writes here).
       */
      companyId?: string;
      /** Caller's role on the active tenant. Populated by `requireTenant`. */
      role?: Role;
      /** Full active-membership row. Populated by `requireTenant`. */
      membership?: ActiveMembership;
    }
  }
}

export {};
