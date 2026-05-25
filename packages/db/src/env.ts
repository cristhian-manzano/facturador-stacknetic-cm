/**
 * Tiny env loader for `@facturador/db` tooling (seed, future migration scripts).
 *
 * This is the ONLY file in `packages/db` permitted to read `process.env`
 * (enforced by `no-restricted-syntax` in @facturador/config/eslint, with a
 * targeted override for `**\/src/env.ts`).
 *
 * Scope: just enough to seed the dev tenant. A Zod-validated schema for the
 * full DB env (DATABASE_URL, pool sizing, etc.) lands in SPEC-0006 alongside
 * the logger redaction list.
 */

export interface SeedEnv {
  /** Email of the demo admin user; lowercased by the seed before insert. */
  adminEmail: string;
  /** Plaintext password used ONLY to compute an argon2id hash at seed time. */
  adminPassword: string;
}

const DEFAULT_ADMIN_EMAIL = "admin@facturador.test";
/**
 * Dev-only placeholder. MUST be overridden via `SEED_ADMIN_PASSWORD` in any
 * non-development environment. See ai/reviews/0004-database-and-prisma-review.md
 * for the security caveat.
 */
const DEFAULT_ADMIN_PASSWORD = "Admin123!";

export function readSeedEnv(): SeedEnv {
  return {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
  };
}
