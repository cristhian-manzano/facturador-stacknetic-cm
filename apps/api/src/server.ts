/**
 * Express 5 app factory for apps/api.
 *
 * Middleware order (per SPEC-0006 §FR-4 + §6.4 + §6.6 + TASKS-0006 §5.1
 * + SPEC-0010 §6.6):
 *
 *   1. `cookieParser`         — parse incoming Cookie header into `req.cookies`.
 *   2. `requestIdMiddleware`  — ensure every request carries an `X-Request-Id`.
 *   3. `createRequestLogger`  — attach a child Pino logger to `req.log`.
 *   4. `express.json()`       — JSON body parser (after id/log so a malformed
 *                                body still produces a correlated error log).
 *   5. Routes                 — /health, /health-db, /v1/_diag/echo,
 *                                /v1/_diag/forced-error, /api/v1/auth/*,
 *                                /api/v1/me.
 *   6. `errorHandler`         — TERMINAL middleware. MUST be last. Translates
 *                                anything thrown into a `ProblemDetail`.
 *
 * Routes (this slice):
 *   GET  /health                       — process-level liveness.
 *   GET  /health-db                    — DB connectivity readiness probe.
 *   POST /v1/_diag/echo                — Zod-validated echo route.
 *   GET  /v1/_diag/forced-error        — Forced AppError emitter.
 *   POST /api/v1/auth/login            — Login (rate-limited; CSRF-exempt).
 *   POST /api/v1/auth/logout           — Logout (auth + CSRF).
 *   GET  /api/v1/me                    — Current user + memberships (auth).
 *   POST /api/v1/_diag/csrf-check      — CSRF success path (auth + CSRF;
 *                                         non-production only).
 *
 * `createApp` is dependency-injected so tests can pass a stub Prisma client
 * and a stub logger.
 */

import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { prisma as defaultPrisma } from "@facturador/db";
import type { PrismaClient } from "@facturador/db";
import { LoginRequestSchema } from "@facturador/contracts/auth";
import {
  AuthError,
  BusinessError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  ValidationError,
} from "@facturador/utils/errors";
import type { Logger } from "@facturador/logger";
import { logger as defaultLogger } from "./logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { validateBody } from "./middleware/validate.js";
import { buildAuthRouter } from "./auth/routes.js";
import { buildTenantRouter } from "./tenants/routes.js";
import { buildEstablecimientoRouter } from "./establecimientos/routes.js";
import { buildCustomerRouter } from "./customers/routes.js";
import { buildInvoiceRouter } from "./invoices/routes.js";

export interface HealthBody {
  status: "ok";
  service: "api";
  uptimeSec: number;
}

export interface HealthDbOkBody {
  db: "ok";
}

export interface HealthDbErrorBody {
  db: "down";
}

export interface CreateAppOptions {
  prisma?: PrismaClient;
  /**
   * Override the root logger. Tests pass a Pino instance configured with
   * a custom `destination` stream so log lines can be captured and asserted.
   */
  logger?: Logger;
  /**
   * Override the SRI-Core base URL used by the invoice orchestrator. Tests
   * point this at the MSW stub host so outbound emit / refresh calls are
   * intercepted in-process.
   */
  sriCoreBaseUrl?: string;
  /**
   * Override the fetch implementation used to talk to SRI-Core. Tests
   * inject `undici.fetch` / MSW-fitted fetch as needed.
   */
  sriCoreFetchImpl?: typeof fetch;
  /**
   * Override the HS256 service-JWT secret used by the invoice orchestrator
   * when calling sri-core. Defaults to `env.SERVICE_JWT_SECRET`.
   */
  serviceJwtSecret?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const prisma = options.prisma ?? defaultPrisma;
  const rootLogger = options.logger ?? defaultLogger;

  app.disable("x-powered-by");

  // Trust the loopback proxy in tests + dev (Supertest connects via ::ffff:127.0.0.1).
  // The rate-limit library inspects `app.get("trust proxy")` to decide how to
  // resolve `req.ip`. We deliberately use the conservative "loopback" preset:
  // in production behind a real proxy, set `TRUST_PROXY=1` and update here.
  app.set("trust proxy", "loopback");

  // -- 0) Cookie parser. MUST run before the auth middlewares that read
  //       `req.cookies`. Cookies are not logged thanks to the project-wide
  //       redaction list in @facturador/logger.
  app.use(cookieParser());

  // -- 1) Correlation id (must run BEFORE the logger so the child carries it).
  app.use(requestIdMiddleware);

  // -- 2) Request-scoped child logger + access log line on `finish`.
  app.use(createRequestLogger(rootLogger));

  // -- 3) Body parser. After logger so a body parse error has a correlated id.
  app.use(express.json({ limit: "1mb" }));

  // ---------------- Routes ----------------------------------------------

  app.get("/health", (_req: Request, res: Response<HealthBody>) => {
    res.json({
      status: "ok",
      service: "api",
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get(
    "/health-db",
    async (_req: Request, res: Response<HealthDbOkBody | HealthDbErrorBody>) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ db: "ok" });
      } catch {
        // Never include the underlying error message in the response body
        // (it can leak DSN fragments or pg-specific internals — see
        // ai/context/security.md). 503 is the readiness contract.
        res.status(503).json({ db: "down" });
      }
    },
  );

  // Zod-validated echo route used by Phase 6/7 Supertest assertions. Validates
  // through `LoginRequestSchema` (no auth side-effects) and echoes the parsed
  // body so a happy path returns 200; a bad body throws `ValidationError` and
  // the terminal error handler renders a `ProblemDetail` with `errors` populated.
  app.post("/v1/_diag/echo", validateBody(LoginRequestSchema), (req: Request, res: Response) => {
    // The validator re-assigns `req.body` with the parsed shape; safe to echo.
    // We deliberately echo `email` only — NEVER `password`, even on a happy
    // path, so this route is safe to leave on in non-prod.
    const body = req.body as { email: string };
    res.json({ ok: true, email: body.email, requestId: req.id });
  });

  // Forced-error matrix: TASKS-0006 §6.2 + Phase 7.
  const ForcedTypeSchema = z.enum([
    "auth",
    "forbidden",
    "not_found",
    "conflict",
    "rate_limit",
    "upstream",
    "business",
    "validation",
    "unknown",
  ]);

  app.get("/v1/_diag/forced-error", ((req, _res, next) => {
    const parsed = ForcedTypeSchema.safeParse(req.query.type);
    if (!parsed.success) {
      next(
        new ValidationError("Invalid forced-error type", {
          errors: [{ identificador: "type", mensaje: "Unknown forced-error type", tipo: "ERROR" }],
        }),
      );
      return;
    }
    switch (parsed.data) {
      case "auth":
        next(new AuthError());
        return;
      case "forbidden":
        next(new ForbiddenError());
        return;
      case "not_found":
        next(new NotFoundError("invoice"));
        return;
      case "conflict":
        next(new ConflictError("Duplicate", "invoice.duplicate_clave"));
        return;
      case "rate_limit":
        next(new RateLimitError());
        return;
      case "upstream":
        next(new UpstreamError("SRI unavailable", "sri.network"));
        return;
      case "business":
        next(new BusinessError("Totals mismatch", "invoice.totals_mismatch"));
        return;
      case "validation":
        next(
          new ValidationError("Forced validation failure", {
            errors: [{ identificador: "field", mensaje: "Required", tipo: "ERROR" }],
          }),
        );
        return;
      case "unknown":
        next(new Error("boom — unexpected"));
        return;
    }
  }) as RequestHandler);

  // ---------------- Auth routes ---------------------------------------
  // Mount under /api/v1 so `POST /api/v1/auth/login`, `GET /api/v1/me`, etc.
  app.use("/api/v1", buildAuthRouter({ prisma, logger: rootLogger }));

  // ---------------- Tenants + RBAC routes -----------------------------
  // Mount under /api/v1 so `GET /api/v1/tenants`, `POST /api/v1/session/tenant`,
  // `PATCH /api/v1/tenants/:id`, member management, etc. The router contains
  // its own `requireSession`/`requireTenant`/`requirePermission` chains.
  app.use("/api/v1", buildTenantRouter({ prisma, logger: rootLogger }));

  // ---------------- Establecimientos + Emission Points (SPEC-0030) ----
  // Tenant-scoped CRUD for billing infrastructure. The router wires its
  // own `requireSession`/`requireTenant`/`requirePermission` chains; reads
  // are open to all tenant members, writes require `establecimiento.manage`.
  app.use("/api/v1", buildEstablecimientoRouter({ prisma, logger: rootLogger }));

  // ---------------- Customers (SPEC-0031) -----------------------------
  // Tenant-scoped CRUD for the customer catalog (RUC/cédula/pasaporte/
  // consumidor final/exterior). Reads gate on `customer.read`; writes use
  // `customer.create|update|delete`. Includes the idempotent
  // `POST /customers/consumidor-final` endpoint used by the orchestrator.
  app.use("/api/v1", buildCustomerRouter({ prisma, logger: rootLogger }));

  // ---------------- Invoices (SPEC-0032 + SPEC-0033) ------------------
  // Tenant-scoped CRUD for the invoice draft + orchestrator endpoints
  // (emit / reissue / refresh). The router mints a fresh service JWT
  // per outbound sri-core call (60 s TTL). Tests can pin
  // `sriCoreBaseUrl` to the MSW stub host.
  app.use(
    "/api/v1",
    buildInvoiceRouter({
      prisma,
      logger: rootLogger,
      ...(options.sriCoreBaseUrl === undefined ? {} : { sriCoreBaseUrl: options.sriCoreBaseUrl }),
      ...(options.sriCoreFetchImpl === undefined ? {} : { fetchImpl: options.sriCoreFetchImpl }),
      ...(options.serviceJwtSecret === undefined
        ? {}
        : { serviceJwtSecret: options.serviceJwtSecret }),
    }),
  );

  // ---------------- Terminal middleware (MUST be last) -------------------
  app.use(errorHandler);

  return app;
}
