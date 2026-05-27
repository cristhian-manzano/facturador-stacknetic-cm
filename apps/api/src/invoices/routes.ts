/**
 * Invoices router — mounts SPEC-0032 + SPEC-0033 endpoints under `/api/v1`.
 *
 * Mount table:
 *
 *   POST   /api/v1/invoices                       requireSession+CSRF+requireTenant+invoice.create
 *   GET    /api/v1/invoices                       requireSession+requireTenant+invoice.read
 *   POST   /api/v1/invoices/preview-totals        requireSession+CSRF+requireTenant+invoice.read
 *   GET    /api/v1/invoices/:id                   requireSession+requireTenant+invoice.read
 *   PATCH  /api/v1/invoices/:id                   requireSession+CSRF+requireTenant+invoice.create
 *   DELETE /api/v1/invoices/:id                   requireSession+CSRF+requireTenant+invoice.create
 *   POST   /api/v1/invoices/:id/emit              requireSession+CSRF+requireTenant+invoice.emit
 *   POST   /api/v1/invoices/:id/reissue           requireSession+CSRF+requireTenant+invoice.reissue
 *   POST   /api/v1/invoices/:id/refresh           requireSession+CSRF+requireTenant+invoice.read
 *
 * Notes:
 *   - `preview-totals` is mounted BEFORE the `:id` routes so the literal
 *     path matches first. It is a POST (not GET) because the body carries
 *     full invoice payloads; CSRF-protected against cross-site forgery.
 *   - The orchestrator routes (`emit`, `reissue`, `refresh`) live on the
 *     same router so they share the same auth chain.
 */
import { Router } from "express";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

import { assertCsrf } from "../auth/csrf.js";
import { requirePermission } from "../auth/require-permission.js";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";

import { buildInvoiceHandlers } from "./handlers.js";
import { buildOrchestratorHandlers } from "./orchestrator.js";

export interface InvoiceRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Override sri-core URL for tests. */
  sriCoreBaseUrl?: string;
  /** Override fetch impl for tests. */
  fetchImpl?: typeof fetch;
  /** Override service-JWT secret for tests. */
  serviceJwtSecret?: string;
}

export function buildInvoiceRouter(deps: InvoiceRouterDeps): Router {
  const router: Router = Router();
  // Forward sri-core overrides to BOTH the CRUD handlers (the detail
  // endpoint hydrates SriDocument + events) and the orchestrator (emit /
  // reissue / refresh).
  const handlers = buildInvoiceHandlers({
    prisma: deps.prisma,
    logger: deps.logger,
    ...(deps.sriCoreBaseUrl === undefined ? {} : { sriCoreBaseUrl: deps.sriCoreBaseUrl }),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.serviceJwtSecret === undefined ? {} : { serviceJwtSecret: deps.serviceJwtSecret }),
  });
  const orchestrator = buildOrchestratorHandlers({
    prisma: deps.prisma,
    logger: deps.logger,
    ...(deps.sriCoreBaseUrl === undefined ? {} : { sriCoreBaseUrl: deps.sriCoreBaseUrl }),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.serviceJwtSecret === undefined ? {} : { serviceJwtSecret: deps.serviceJwtSecret }),
  });
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });

  // -- Reads ---------------------------------------------------------------
  router.get(
    "/invoices",
    requireSession,
    requireTenant,
    requirePermission("invoice.read"),
    handlers.listInvoices,
  );

  // preview-totals MUST be declared before `/:id` so the literal path matches.
  router.post(
    "/invoices/preview-totals",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.read"),
    handlers.previewTotals,
  );

  router.get(
    "/invoices/:id",
    requireSession,
    requireTenant,
    requirePermission("invoice.read"),
    handlers.getInvoice,
  );

  // -- Writes (draft CRUD) -------------------------------------------------
  router.post(
    "/invoices",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.create"),
    handlers.createInvoice,
  );

  router.patch(
    "/invoices/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.create"),
    handlers.updateInvoice,
  );

  router.delete(
    "/invoices/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.create"),
    handlers.deleteInvoice,
  );

  // -- Orchestrator (emit / reissue / refresh) -----------------------------
  router.post(
    "/invoices/:id/emit",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.emit"),
    orchestrator.emit,
  );

  router.post(
    "/invoices/:id/reissue",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.reissue"),
    orchestrator.reissue,
  );

  router.post(
    "/invoices/:id/refresh",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("invoice.read"),
    orchestrator.refresh,
  );

  return router;
}
