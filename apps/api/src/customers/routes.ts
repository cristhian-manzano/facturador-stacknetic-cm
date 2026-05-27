/**
 * Customers router — mounts SPEC-0031 endpoints under `/api/v1`.
 *
 * Mount table:
 *
 *   GET    /api/v1/customers                          requireSession+requireTenant+customer.read
 *   GET    /api/v1/customers/:id                      requireSession+requireTenant+customer.read
 *   POST   /api/v1/customers                          + CSRF + customer.create
 *   POST   /api/v1/customers/consumidor-final         + CSRF + customer.read (idempotent)
 *   PATCH  /api/v1/customers/:id                      + CSRF + customer.update
 *   DELETE /api/v1/customers/:id                      + CSRF + customer.delete
 *
 * Notes:
 *   - `consumidor-final` is mounted BEFORE the `:id` PATCH/DELETE routes so
 *     the literal path matches first. It is a `POST` (not `GET`) because it
 *     performs an idempotent upsert and must be CSRF-protected against a
 *     hostile cross-site origin trying to mint rows on the user's behalf.
 *   - Reads (GET list + GET :id + the ensure-consumidor-final upsert) gate
 *     on the read permission so VIEWER (the most restrictive role) can still
 *     browse the catalogue.
 *   - Every mutating verb requires both CSRF (`assertCsrf`) and the
 *     write-flavored permission (`customer.create|update|delete`).
 */
import { Router } from "express";

import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";

import { assertCsrf } from "../auth/csrf.js";
import { requirePermission } from "../auth/require-permission.js";
import { buildRequireSession } from "../auth/require-session.js";
import { buildRequireTenant } from "../auth/require-tenant.js";

import { buildCustomerHandlers } from "./handlers.js";

export interface CustomerRouterDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export function buildCustomerRouter(deps: CustomerRouterDeps): Router {
  const router: Router = Router();
  const handlers = buildCustomerHandlers(deps);
  const requireSession = buildRequireSession({ prisma: deps.prisma });
  const requireTenant = buildRequireTenant({ prisma: deps.prisma });

  // -- Reads ---------------------------------------------------------------
  router.get(
    "/customers",
    requireSession,
    requireTenant,
    requirePermission("customer.read"),
    handlers.listCustomers,
  );

  // The consumidor-final endpoint MUST be declared before the `:id` route
  // so the literal path matches first.
  router.post(
    "/customers/consumidor-final",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("customer.read"),
    handlers.ensureConsumidorFinalEndpoint,
  );

  router.get(
    "/customers/:id",
    requireSession,
    requireTenant,
    requirePermission("customer.read"),
    handlers.getCustomer,
  );

  // -- Writes --------------------------------------------------------------
  router.post(
    "/customers",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("customer.create"),
    handlers.createCustomer,
  );

  router.patch(
    "/customers/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("customer.update"),
    handlers.updateCustomer,
  );

  router.delete(
    "/customers/:id",
    requireSession,
    assertCsrf,
    requireTenant,
    requirePermission("customer.delete"),
    handlers.deleteCustomer,
  );

  return router;
}
