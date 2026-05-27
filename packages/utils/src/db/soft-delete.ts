/**
 * Tiny helpers to keep `deletedAt: null` filters DRY across repositories
 * (REVIEW-0004 §7 #5).
 *
 * Why bother:
 *
 *   - Almost every tenant-scoped query in `apps/api` ends in
 *     `where: { companyId, ..., deletedAt: null }`. Forgetting the
 *     trailing `deletedAt: null` returns soft-deleted rows in
 *     production. The custom ESLint rule sketched in REVIEW-0004 §7 #3
 *     would catch missing `companyId`; THIS helper closes the
 *     `deletedAt` corner.
 *   - Reads slightly nicer at the call site:
 *       `where: withSoftDelete({ companyId, customerId })`
 *     vs:
 *       `where: { companyId, customerId, deletedAt: null }`.
 *     Same number of characters, but the helper name documents
 *     intent.
 *
 * Why this lives in `utils/db` (not `db`):
 *
 *   - `@facturador/db` carries the generated Prisma client + migrations
 *     and is heavy. `utils/db` is a no-runtime-dep helper that the apps
 *     can import without dragging Prisma. The `where` clause shape is a
 *     plain object literal so Prisma's inference still narrows correctly
 *     at the call site.
 *
 * Usage:
 *
 *   ```ts
 *   import { withSoftDelete, isActive } from "@facturador/utils/db";
 *
 *   // Inline:
 *   prisma.customer.findMany({ where: { companyId, ...isActive } });
 *
 *   // Composed:
 *   prisma.customer.findMany({ where: withSoftDelete({ companyId }) });
 *   ```
 *
 * NOT included (out of scope):
 *
 *   - A SOFT-DELETE setter helper (`{ deletedAt: new Date() }`). That's
 *     a write-side concern and is one line at the call site already.
 *   - A "without soft-delete" inverse (returning ALL rows). The only
 *     legitimate caller for that is an admin tool / audit query, both
 *     of which should be explicit at the call site.
 */

/**
 * `where` fragment that filters out soft-deleted rows. Spread into any
 * Prisma `where` clause:
 *
 *   ```ts
 *   prisma.customer.findMany({ where: { companyId, ...isActive } });
 *   ```
 *
 * Typed `as const` so the literal `null` is preserved — Prisma's
 * `where: { deletedAt: null }` is the SHAPE that matches all rows where
 * the timestamp column is NULL (NOT the discriminator `null`-vs-non-null
 * sentinel). If we typed it as `Date | null`, callers would lose the
 * narrowing.
 */
export const isActive = { deletedAt: null } as const;

/**
 * Wrap a `where` object with the `deletedAt: null` filter.
 *
 * The return type drops any `deletedAt` the caller passed and re-pins it
 * to `null` so the result type stays consistent (and TypeScript doesn't
 * collapse the intersection to `never` when a stale caller passes
 * `deletedAt: someDate`). We use a generic over
 * `W extends Record<string, unknown>` rather than `W extends object` so
 * the inferred argument is always a real object literal (not, e.g.,
 * `Date`).
 *
 * If the input already has a `deletedAt` key, OUR `null` wins (spread
 * order matters). That's intentional: a repository should NEVER read a
 * soft-deleted row via this helper, even if a stale caller passes
 * `{ deletedAt: someDate }`.
 *
 * @example
 *   prisma.customer.findFirst({
 *     where: withSoftDelete({ companyId, id }),
 *   });
 */
export function withSoftDelete<W extends Record<string, unknown>>(
  where: W,
): Omit<W, "deletedAt"> & { deletedAt: null } {
  return { ...where, deletedAt: null };
}
