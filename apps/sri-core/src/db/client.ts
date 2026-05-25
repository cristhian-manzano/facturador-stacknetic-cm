/**
 * Lazy Prisma singleton for apps/sri-core.
 *
 * Mirrors `@facturador/db`'s `prisma` export but reads from this service's
 * own connection URL. We re-export the canonical singleton from
 * `@facturador/db` rather than minting a second one so each process keeps
 * a single connection pool.
 */
export { prisma, createPrismaClient, newId, Prisma, SriEstado, SriEtapa } from "@facturador/db";
export type { PrismaClient } from "@facturador/db";
