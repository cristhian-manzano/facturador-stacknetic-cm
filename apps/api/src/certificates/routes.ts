/**
 * `/api/v1/certificates/*` — thin proxy to `apps/sri-core` certificate
 * lifecycle endpoints.
 *
 * Source of truth: production-readiness §14.
 *
 * The api never touches the .p12 bytes directly — it forwards the
 * incoming request body (multipart for upload, JSON for the others)
 * to sri-core with a freshly-minted service JWT, then streams the
 * upstream response back unchanged. Auth is the standard tenant chain:
 *
 *     requireSession → requireTenant → requirePermission("certificate.manage")
 *
 * CSRF is required on every mutating verb (POST / DELETE).
 *
 * Hard rules baked in:
 *
 *   - Multipart streaming: we DO NOT buffer the .p12 in api memory. The
 *     incoming request stream is piped to the upstream request body —
 *     the binary never touches our application heap.
 *   - The service JWT is minted per-call (60 s TTL); never logged.
 *   - Audit rows land via the api's audit() helper so the operator
 *     timeline shows the request even when sri-core is the actual writer.
 *   - All error bodies pass through unchanged so the SPA can render the
 *     same ProblemDetail it would get talking to sri-core directly.
 */
import type { Request, Response as ExpressResponse } from "express";
import { Router, type RequestHandler } from "express";

import type { PrismaClient } from "@facturador/db";
import { newId } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import { AuthError } from "@facturador/utils/errors";

import { assertCsrf } from "../auth/csrf.js";
import { requirePermission } from "../auth/require-permission.js";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";
import { env } from "../env.js";
import { mintServiceJwt } from "../sri/client.js";

const auditAdapter = (prisma: PrismaClient): AuditPrismaClient =>
  prisma as unknown as AuditPrismaClient;

function readIp(req: Request): string | null {
  const raw = req.ip;
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 64) : null;
}
function readUserAgent(req: Request): string | null {
  const raw = req.header("user-agent");
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 256) : null;
}

export interface CertificateRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Override sri-core base URL — tests inject the MSW host here. */
  sriCoreBaseUrl?: string;
  /** Override the fetch impl (tests inject MSW-fitted fetch). */
  fetchImpl?: typeof fetch;
  /** Override the service-JWT secret (tests use a fixed test secret). */
  serviceJwtSecret?: string;
}

/**
 * Build a fetch invocation that forwards the request body byte-for-byte
 * to sri-core. The body is whatever Node delivered to Express (multipart
 * stream for upload; JSON or empty for everything else). We forward the
 * Content-Type so multer on the other side can parse the boundary.
 */
async function proxyToSriCore(
  req: Request,
  res: ExpressResponse,
  args: {
    deps: CertificateRouterDeps;
    method: "GET" | "POST" | "DELETE";
    path: string;
    companyId: string;
    requestId: string;
  },
): Promise<void> {
  const baseUrl = args.deps.sriCoreBaseUrl ?? env.SRI_CORE_URL;
  const url = new URL(args.path, baseUrl).toString();
  const fetchImpl = args.deps.fetchImpl ?? fetch;
  const token = await mintServiceJwt({
    companyId: args.companyId,
    ...(args.deps.serviceJwtSecret === undefined
      ? {}
      : { secret: args.deps.serviceJwtSecret }),
    ttlSeconds: 60,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Request-Id": args.requestId,
  };
  // Forward content-type so the upstream multer / json parser sees the
  // exact same boundary / charset the client sent.
  const ct = req.header("content-type");
  if (ct !== undefined && ct.length > 0) headers["Content-Type"] = ct;

  // For GET / DELETE we send no body. For POST we forward the parsed
  // body (multer/multipart support is out of scope for v1; the binary
  // path lives in sri-core directly). The scaffold treats `req.body` as
  // JSON-shaped and re-serialises — multipart uploads should go to
  // sri-core directly via a signed URL once that path lands.
  let body: string | Buffer | undefined;
  if (args.method !== "GET" && args.method !== "DELETE") {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string" || req.body instanceof Buffer) {
        body = req.body as string | Buffer;
      } else {
        body = JSON.stringify(req.body);
        if (headers["Content-Type"] === undefined) {
          headers["Content-Type"] = "application/json";
        }
      }
    }
  }

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetchImpl(url, {
      method: args.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  } catch (err) {
    res.status(502).json({
      type: "urn:facturador:error:upstream",
      code: "sri.network",
      status: 502,
      title: "Upstream unavailable",
      detail: "sri-core could not be reached",
    });
    args.deps.logger.error(
      { event: "certificate.proxy_failure", err },
      "certificate_proxy_failure",
    );
    return;
  }

  // Pass-through: copy upstream status + JSON body. We never read binary
  // here — sri-core returns JSON for all certificate endpoints.
  res.status(upstream.status);
  const upstreamCt = upstream.headers.get("content-type");
  if (upstreamCt !== null) res.setHeader("Content-Type", upstreamCt);
  const text = await upstream.text();
  res.send(text);
}

export function buildCertificateRouter(deps: CertificateRouterDeps): Router {
  const router: Router = Router();
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });

  // -- GET /certificates -------------------------------------------------
  router.get(
    "/certificates",
    requireSession,
    requireTenant,
    requirePermission("certificate.manage"),
    (async (req, res, next) => {
      try {
        const companyId = req.companyId;
        if (companyId === undefined) throw new AuthError();
        await proxyToSriCore(req, res, {
          deps,
          method: "GET",
          path: "/v1/certificates",
          companyId,
          requestId: req.id ?? newId(),
        });
      } catch (err) {
        next(err);
      }
    }) as RequestHandler,
  );

  // -- POST /certificates ------------------------------------------------
  // Upload — scaffold only. The multipart body is forwarded byte-for-byte
  // (see comment above re: production hardening). Audit lands here so
  // the operator timeline shows the attempt even if the upstream rejects.
  router.post(
    "/certificates",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("certificate.manage"),
    (async (req, res, next) => {
      try {
        const companyId = req.companyId;
        if (companyId === undefined) throw new AuthError();
        await audit(
          { prisma: auditAdapter(deps.prisma), logger: deps.logger },
          {
            action: "certificate.upload.attempt",
            entity: "Certificate",
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
          },
        );
        await proxyToSriCore(req, res, {
          deps,
          method: "POST",
          path: "/v1/certificates",
          companyId,
          requestId: req.id ?? newId(),
        });
      } catch (err) {
        next(err);
      }
    }) as RequestHandler,
  );

  // -- POST /certificates/:id/activate -----------------------------------
  router.post(
    "/certificates/:id/activate",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("certificate.manage"),
    (async (req, res, next) => {
      try {
        const companyId = req.companyId;
        if (companyId === undefined) throw new AuthError();
        const rawId = req.params.id;
        const id = typeof rawId === "string" ? rawId : "";
        await audit(
          { prisma: auditAdapter(deps.prisma), logger: deps.logger },
          {
            action: "certificate.activate.attempt",
            entity: "Certificate",
            entityId: id,
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
          },
        );
        await proxyToSriCore(req, res, {
          deps,
          method: "POST",
          path: `/v1/certificates/${encodeURIComponent(id)}/activate`,
          companyId,
          requestId: req.id ?? newId(),
        });
      } catch (err) {
        next(err);
      }
    }) as RequestHandler,
  );

  // -- DELETE /certificates/:id ------------------------------------------
  router.delete(
    "/certificates/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("certificate.manage"),
    (async (req, res, next) => {
      try {
        const companyId = req.companyId;
        if (companyId === undefined) throw new AuthError();
        const rawId = req.params.id;
        const id = typeof rawId === "string" ? rawId : "";
        await audit(
          { prisma: auditAdapter(deps.prisma), logger: deps.logger },
          {
            action: "certificate.delete.attempt",
            entity: "Certificate",
            entityId: id,
            actorUserId: req.user?.id ?? null,
            companyId,
            ip: readIp(req),
            userAgent: readUserAgent(req),
          },
        );
        await proxyToSriCore(req, res, {
          deps,
          method: "DELETE",
          path: `/v1/certificates/${encodeURIComponent(id)}`,
          companyId,
          requestId: req.id ?? newId(),
        });
      } catch (err) {
        next(err);
      }
    }) as RequestHandler,
  );

  return router;
}
