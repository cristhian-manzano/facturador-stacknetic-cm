/**
 * Express request augmentation for apps/sri-core.
 *
 * Adds:
 *   - `req.id`      ULID set by `requestIdMiddleware`.
 *   - `req.log`     Child Pino logger from the request-logger middleware.
 *   - `req.service` Service-JWT claims attached by `requireServiceJwt`
 *                   (SPEC-0020 §6.3). The shape is intentionally tiny:
 *                   `companyId` (the JWT `sub`) and optional `jti` for
 *                   the audit log. No raw token, no PII.
 *
 * Mirrors `apps/api/src/types/express.d.ts`. The two surfaces are
 * intentionally duplicated rather than hoisted into a shared package so the
 * per-app `req.log` type stays scoped to each service.
 */
import type { Logger } from "@facturador/logger";

export interface ServiceJwtContext {
  readonly companyId: string;
  readonly jti?: string;
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      log?: Logger;
      service?: ServiceJwtContext;
    }
  }
}

export {};
