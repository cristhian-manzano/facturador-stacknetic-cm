/**
 * Subpath: `@facturador/utils/db`.
 *
 * Lightweight database helpers that don't drag the Prisma client. See
 * `soft-delete.ts` for the rationale.
 */
export { isActive, withSoftDelete } from "./soft-delete.js";
