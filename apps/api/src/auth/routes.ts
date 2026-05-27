/**
 * Auth router — mounts `POST /auth/login`, `POST /auth/logout`,
 * `GET /me`, plus a stub `POST /_diag/csrf-check` route used by the
 * integration tests to exercise the assertCsrf middleware against an
 * authenticated request.
 *
 * Mount order (defined by `createApp` in server.ts):
 *   1. cookieParser
 *   2. requestId + logger
 *   3. express.json
 *   4. THIS router under `/api/v1`
 *      - login: rate limiters → validateBody → handler
 *      - logout: requireSession → assertCsrf → handler
 *      - me: requireSession → handler
 *      - _diag/csrf-check: requireSession → assertCsrf → 204
 *   5. errorHandler (terminal)
 *
 * Public surface:
 *   - `POST   /api/v1/auth/login`     — rate-limited, CSRF-exempt.
 *   - `POST   /api/v1/auth/logout`    — auth + CSRF.
 *   - `GET    /api/v1/me`             — auth only.
 *   - `POST   /api/v1/_diag/csrf-check` — auth + CSRF; returns 204 on pass.
 *
 * The `_diag/csrf-check` endpoint is gated behind `NODE_ENV !== "production"`
 * because it exists only to support the test matrix (TASKS-0010 §8.1
 * "Mutating endpoint with valid CSRF: passes through using a stub
 * authenticated route").
 */

import { Router } from "express";

import { LoginRequestSchema } from "@facturador/contracts/auth";
import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

import { env } from "../env.js";
import { validateBody } from "../middleware/validate.js";

import { assertCsrf } from "./csrf.js";
import { buildAuthHandlers } from "./handlers.js";
import { buildLoginEmailRateLimiter, buildLoginIpRateLimiter } from "./rate-limit.js";
import { buildRequireSession } from "./require-session.js";

export interface AuthRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export function buildAuthRouter(deps: AuthRouterDeps): Router {
  const router: Router = Router();
  const handlers = buildAuthHandlers(deps);
  const requireSession = buildRequireSession({ prisma: deps.prisma });

  // /auth/login is CSRF-exempt by design (no session yet to mint a token
  // for). It IS rate-limited per-IP and per-email.
  router.post(
    "/auth/login",
    buildLoginIpRateLimiter(),
    buildLoginEmailRateLimiter(),
    validateBody(LoginRequestSchema),
    handlers.login,
  );

  // /auth/logout requires both an authenticated session and a valid CSRF.
  router.post("/auth/logout", requireSession, assertCsrf, handlers.logout);

  // /me is a safe (GET) endpoint, so CSRF doesn't apply.
  router.get("/me", requireSession, handlers.me);

  // Diagnostic endpoint used by the integration test for CSRF success.
  // Only mounted outside production.
  if (env.NODE_ENV !== "production") {
    router.post("/_diag/csrf-check", requireSession, assertCsrf, (_req, res) => {
      res.status(204).send();
    });
  }

  return router;
}
