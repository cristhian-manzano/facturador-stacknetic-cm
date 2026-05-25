/**
 * Express 5 app factory for apps/sri-core.
 *
 * Middleware order (per SPEC-0006 §FR-4 + SPEC-0020 §6.5 + PROMPT-0020):
 *
 *   1. `requestIdMiddleware`  — ensure every request carries an `X-Request-Id`.
 *   2. `createRequestLogger`  — attach a child Pino logger to `req.log`.
 *   3. `express.json()`       — JSON body parser, 1 MB cap.
 *   4. health routes          — `/health`, `/healthz`, `/readyz` (no auth).
 *   5. service-jwt gate       — every `/v1/*` route requires a fresh service JWT.
 *   6. documents routes       — `/v1/documents/*` (SPEC-0020 §6.5).
 *   7. diag routes (legacy)   — kept for the existing forced-error matrix tests.
 *   8. `errorHandler`         — TERMINAL middleware. MUST be last.
 *
 * Dependency injection:
 *   - The factory accepts an optional Prisma client + logger + service-JWT
 *     secret + stub-mode flag. Tests inject a per-schema Prisma client and
 *     a deterministic secret; the production boot path falls through to
 *     env-derived defaults.
 */
import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "@facturador/db";
import type { PrismaClient } from "@facturador/db";
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
import { env as defaultEnv } from "./env.js";
import { logger as defaultLogger } from "./logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { validateBody } from "./middleware/validate.js";
import { buildRequireServiceJwt } from "./auth/service-jwt.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildDocumentsRouter } from "./routes/documents.js";
import { buildCertificatesRouter, multerErrorHandler } from "./routes/certificates.js";
import type { BlobStore } from "./blobs/blob-store.js";
import { FilesystemBlobStore } from "./blobs/blob-store.js";
import { AutorizacionClient, RecepcionClient } from "./soap/index.js";

export interface HealthBody {
  status: "ok";
  service: "sri-core";
  uptimeSec: number;
}

export interface CreateAppOptions {
  /** Inject a Prisma client. Tests pass a per-schema client. */
  prisma?: PrismaClient;
  /**
   * Override the root logger. Tests pass a Pino instance configured with
   * a custom `destination` stream so log lines can be captured and asserted.
   */
  logger?: Logger;
  /**
   * Override the service-JWT secret. Tests use a deterministic value so
   * they can mint a matching token. Production passes `env.SERVICE_JWT_SECRET`.
   */
  serviceJwtSecret?: string;
  /**
   * Override the stub-mode flag. Tests flip it per case. Production reads
   * from env.
   */
  stubMode?: boolean;
  /**
   * Override the BlobStore. Tests pass an `InMemoryBlobStore` so they
   * don't write to disk. Production defaults to `FilesystemBlobStore`
   * rooted at `env.SRI_BLOB_FS_ROOT`.
   */
  blobStore?: BlobStore;
  /**
   * Override the SOAP clients. Tests pass mocks so the orchestrator
   * never reaches a real network. Production constructs them from env.
   */
  recepcionClient?: RecepcionClient;
  autorizacionClient?: AutorizacionClient;
}

// Local Zod schema for the diagnostic echo. Lives here because sri-core has
// no public auth surface today; we just need to exercise `validateBody` end-to-end.
const EchoBodySchema = z.object({
  ping: z.string().min(1).max(64),
});

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const rootLogger = options.logger ?? defaultLogger;
  const prisma = options.prisma ?? defaultPrisma;
  const serviceJwtSecret = options.serviceJwtSecret ?? defaultEnv.SERVICE_JWT_SECRET;
  const stubMode = options.stubMode ?? defaultEnv.SRI_STUB_MODE;
  // SPEC-0026: assemble BlobStore + SOAP clients. The orchestrator needs
  // them in non-stub mode; stub mode passes them through but never
  // touches the network or the disk for emit.
  const blobStore: BlobStore =
    options.blobStore ?? new FilesystemBlobStore({ root: defaultEnv.SRI_BLOB_FS_ROOT });
  const recepcionClient =
    options.recepcionClient ??
    new RecepcionClient({
      env: {
        SRI_RECEPCION_URL_PRUEBAS: defaultEnv.SRI_RECEPCION_URL_PRUEBAS,
        SRI_RECEPCION_URL_PRODUCCION: defaultEnv.SRI_RECEPCION_URL_PRODUCCION,
        SRI_HTTP_TIMEOUT_MS: defaultEnv.SRI_HTTP_TIMEOUT_MS,
      },
      logger: rootLogger,
    });
  const autorizacionClient =
    options.autorizacionClient ??
    new AutorizacionClient({
      env: {
        SRI_AUTORIZACION_URL_PRUEBAS: defaultEnv.SRI_AUTORIZACION_URL_PRUEBAS,
        SRI_AUTORIZACION_URL_PRODUCCION: defaultEnv.SRI_AUTORIZACION_URL_PRODUCCION,
        SRI_HTTP_TIMEOUT_MS: defaultEnv.SRI_HTTP_TIMEOUT_MS,
      },
      logger: rootLogger,
    });

  app.disable("x-powered-by");

  // -- 1) Correlation id (must run BEFORE the logger so the child carries it).
  app.use(requestIdMiddleware);

  // -- 2) Request-scoped child logger + access log line on `finish`.
  app.use(createRequestLogger(rootLogger));

  // -- 3) Body parser. NFR-2: refuse > 1 MB.
  app.use(express.json({ limit: "1mb" }));

  // ---------------- Routes ----------------------------------------------

  // Liveness — also serves the docker-compose healthcheck.
  app.get("/health", (_req: Request, res: Response<HealthBody>) => {
    res.json({
      status: "ok",
      service: "sri-core",
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // Readiness + healthz (SPEC-0020 §FR-7).
  app.use(buildHealthRouter({ prisma }));

  // ---------------- Service JWT gate (every /v1/* below) -----------------
  const requireServiceJwt = buildRequireServiceJwt({ secret: serviceJwtSecret });

  // ---------------- Documents API (SPEC-0020 §6.5 + SPEC-0026) -----------
  app.use(
    "/v1/documents",
    requireServiceJwt,
    buildDocumentsRouter({
      prisma,
      stubMode,
      blobStore,
      recepcionClient,
      autorizacionClient,
      logger: rootLogger,
    }),
  );

  // ---------------- Certificates API (SPEC-0021) ------------------------
  // Note: `multerErrorHandler` is mounted directly after the router so it
  // can intercept `LIMIT_FILE_SIZE` (translated to 413) before the
  // generic error handler runs.
  app.use(
    "/v1/certificates",
    requireServiceJwt,
    buildCertificatesRouter({ prisma, logger: rootLogger }),
    multerErrorHandler,
  );

  // ---------------- Diagnostics (existing) -------------------------------
  // The diag echo + forced-error endpoints exist to exercise middleware
  // wiring (request-id, logger, validator, error handler). They are
  // deliberately NOT behind the service-JWT gate — that gate is asserted
  // by the dedicated `documents.test.ts` integration suite.
  app.post("/v1/_diag/echo", validateBody(EchoBodySchema), (req: Request, res: Response) => {
    const body = req.body as { ping: string };
    res.json({ ok: true, ping: body.ping, requestId: req.id });
  });

  // Forced-error matrix — same subclass coverage as apps/api.
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

  // ---------------- Terminal middleware (MUST be last) -------------------
  app.use(errorHandler);

  return app;
}
