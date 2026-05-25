/**
 * `@facturador/db` — shared Prisma client + ULID helper.
 *
 * Single source of truth for database access across `apps/api` and (later)
 * `apps/sri-core`. The client is a module-level singleton so Node's module
 * cache keeps exactly one connection pool per process. A `globalThis` guard
 * survives the dev watcher (`tsx watch`) reloading this module, which would
 * otherwise leak pools.
 *
 * Logging defaults to `warn`/`error` — never `query` in production (leaks
 * parameters, contradicts `ai/context/security.md`). Callers can pass a
 * different log array via `createPrismaClient` for tests.
 */
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";

export type PrismaLogLevel = "info" | "query" | "warn" | "error";

declare global {
  // eslint-disable-next-line no-var
  var __facturadorPrisma__: PrismaClient | undefined;
}

const defaultLog: PrismaLogLevel[] = ["warn", "error"];

export function createPrismaClient(log: PrismaLogLevel[] = defaultLog): PrismaClient {
  return new PrismaClient({ log });
}

export const prisma: PrismaClient = globalThis.__facturadorPrisma__ ?? createPrismaClient();

if (!globalThis.__facturadorPrisma__) {
  globalThis.__facturadorPrisma__ = prisma;
}

/** Generate a fresh ULID for new primary keys. */
export function newId(): string {
  return ulid();
}

export { Prisma, type PrismaClient } from "@prisma/client";

// Re-export the SRI enums so consumers (apps/sri-core) don't depend on
// `@prisma/client` directly. The string literal union type and the
// runtime constant value share the same identifier.
export { SriEstado, SriEtapa } from "@prisma/client";

// Re-export Prisma model row types for consumers that build response
// shapes (e.g. the sri-core routes module). These are pure types —
// they vanish at runtime — so the dependency graph stays clean.
export type {
  Certificate,
  Company,
  SriDocument,
  SriEvent,
  BurnedSecuencial,
  Establecimiento,
  EmissionPoint,
  SecuencialCounter,
  Customer,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  InvoiceAdicional,
} from "@prisma/client";

// Re-export the InvoiceEstado enum so consumers (apps/api) don't depend
// on `@prisma/client` directly.
export { InvoiceEstado } from "@prisma/client";
