/**
 * Per-test Postgres schema harness for the Facturador monorepo.
 *
 * Source of truth: SPEC-0007 §6.3 + TASKS-0007 §2.1.
 *
 * Strategy: each `describe` block (or each test file) calls `createTestSchema()`
 * to receive an isolated, freshly-migrated Postgres schema.  All tables in the
 * Prisma schema (`Company`, `User`, `Membership`, `Session`, `AuditLog`,
 * `Role` enum) materialise inside the new schema; the test's `PrismaClient`
 * is pinned to it via `?schema=...` in the connection URL.
 *
 *   - The schema name is `test_${ulid().toLowerCase()}`.  ULIDs are
 *     monotonic+lexicographic, so adjacent schemas sort together and old
 *     ones are easy to spot if a teardown ever misfires.
 *   - Schema creation happens with `prisma migrate deploy` shelled out under
 *     a schema-scoped `DATABASE_URL`.  Migration deploy is idempotent — it
 *     applies any pending migrations in `packages/db/prisma/migrations`.
 *   - Teardown wraps a `DROP SCHEMA ... CASCADE` in a `try/finally` so even
 *     a thrown test leaves no lingering schema (PROMPT-0007 §6).
 *
 * Parallelism: Vitest by default runs files in parallel threads.  Each thread
 * imports this module once and calls `createTestSchema()`; the resulting
 * schema name is unique to that test file and never shared.  AC-3 of SPEC-0007
 * is satisfied by construction.
 *
 * Connection url:
 *   - `BASE_DATABASE_URL` env var if defined; otherwise `DATABASE_URL`.  The
 *     URL itself is parsed via `new URL()` so we never `${}`-interpolate
 *     unsanitised user input.
 *
 * This module deliberately reads `process.env` directly — env validation lives
 * in workspaces that consume the harness (api, sri-core), not here.  This is
 * the second file in `packages/db` permitted to touch `process.env` (the
 * first is `src/env.ts`; both are exempt via the ESLint override in
 * `@facturador/config/eslint`).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";

/** Resolves `packages/db` (where `prisma/schema.prisma` lives). */
const PACKAGE_DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Strip Prisma schema name from a connection URL and return both pieces.
 *
 * Postgres treats `schema` as a connection-string query parameter on
 * Prisma's side ("search_path" in pg parlance).  Replacing the value is
 * how we route each test's client to its private schema.
 */
function withSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

/**
 * Resolve the DATABASE_URL the harness should clone.  Tests can set
 * `BASE_DATABASE_URL` if they need to point at a different physical database
 * (e.g. CI), but most workflows use the dev value loaded via `dotenv -e ../../.env`.
 */
function resolveBaseUrl(): string {
  const baseUrl = process.env["BASE_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error(
      "[db/test-harness] DATABASE_URL (or BASE_DATABASE_URL) must be set. " +
        "Run via `dotenv -e ../../.env -- vitest` or export it inline.",
    );
  }
  return baseUrl;
}

/**
 * Mint a unique schema identifier.  `test_` prefix + lowercased ULID gives
 * 31 lowercase alnum chars — well under Postgres' 63-char NAMEDATALEN ceiling
 * and guaranteed unique even across parallel processes.
 */
export function newTestSchemaName(): string {
  return `test_${ulid().toLowerCase()}`;
}

/**
 * Snapshot of the resources a test owns inside its schema.  Returned by
 * `createTestSchema()` and consumed by `dropTestSchema()`.
 */
export interface TestSchema {
  /** Postgres schema name (already created + migrated). */
  schema: string;
  /** PrismaClient pinned to the schema via `?schema=...`. */
  prisma: PrismaClient;
  /** The fully-qualified `DATABASE_URL` used by `prisma`. */
  url: string;
}

/**
 * Apply Prisma migrations under a schema-scoped URL.
 *
 * `prisma migrate deploy` is the production-equivalent path: it walks the
 * `prisma/migrations` directory and applies whatever is pending.  Crucially,
 * it CREATES the schema if missing, so we don't need to pre-`CREATE SCHEMA`.
 *
 * We deliberately use `execFileSync` (no shell), pass the URL via env, and
 * pin the schema location with `--schema`.  No user input is concatenated
 * into argv.
 */
function applyMigrations(databaseUrl: string): void {
  execFileSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: PACKAGE_DB_DIR,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );
}

/**
 * Create a fresh, migrated Postgres schema and return a Prisma client pinned
 * to it.  Always pair with `dropTestSchema` in `afterAll` (or use
 * `useTestSchema`, which does it for you).
 */
export async function createTestSchema(): Promise<TestSchema> {
  const baseUrl = resolveBaseUrl();
  const schema = newTestSchemaName();
  const url = withSchema(baseUrl, schema);

  // `prisma migrate deploy` creates the schema before applying migrations.
  applyMigrations(url);

  const prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["warn", "error"],
  });
  // Eagerly connect so a misconfigured URL fails inside `createTestSchema`
  // instead of inside the first query the test runs.
  await prisma.$connect();

  return { schema, prisma, url };
}

/**
 * Drop the schema and disconnect the client.  Safe to call multiple times —
 * the DROP is `IF EXISTS` and `$disconnect` is idempotent.
 *
 * The DROP runs through an ADMIN client (the unscoped base URL) because the
 * pinned `prisma` cannot `DROP SCHEMA` while connected to it.
 */
export async function dropTestSchema(handle: Pick<TestSchema, "schema" | "prisma">): Promise<void> {
  try {
    await handle.prisma.$disconnect();
  } catch {
    // Already disconnected; nothing to clean up here.
  }
  const admin = new PrismaClient({
    datasources: { db: { url: resolveBaseUrl() } },
    log: ["warn", "error"],
  });
  try {
    // Schema is a fully validated identifier we minted via ULID — no
    // user input.  Even so, we double-quote to defang any accidental
    // collision with a reserved word.
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${handle.schema}" CASCADE`);
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Vitest helper that wires `beforeAll` / `afterAll` so a single schema lives
 * for the lifetime of one `describe` block (or one test file).
 *
 * Usage:
 *
 * ```ts
 * import { describe, it, expect } from "vitest";
 * import { useTestSchema } from "@facturador/db/test-harness";
 *
 * describe("login", () => {
 *   const ctx = useTestSchema();
 *   it("creates a user", async () => {
 *     const prisma = ctx.getPrisma();
 *     // ...
 *   });
 * });
 * ```
 *
 * Importing this function pulls in Vitest's global lifecycle hooks
 * (`globals: true` is set by `defineFacturadorVitestConfig`).  We accept the
 * implicit dependency to keep call sites short — this helper exists for
 * Vitest's benefit.
 */
export interface UseTestSchemaHandle {
  /** Returns the PrismaClient pinned to the per-block schema. */
  getPrisma(): PrismaClient;
  /** Returns the schema name (mostly useful for diagnostics). */
  getSchema(): string;
}

export function useTestSchema(): UseTestSchemaHandle {
  // Vitest's `beforeAll`/`afterAll` are globals when `globals: true`. We
  // capture them off `globalThis` so this module doesn't need a static
  // `import { beforeAll } from "vitest"`, which would force every consumer
  // to install Vitest as a dependency of `@facturador/db` (it's a devDep
  // in the consumer instead).
  const g = globalThis as unknown as {
    beforeAll?: (fn: () => Promise<void> | void) => void;
    afterAll?: (fn: () => Promise<void> | void) => void;
  };
  if (typeof g.beforeAll !== "function" || typeof g.afterAll !== "function") {
    throw new Error("[db/test-harness] useTestSchema requires Vitest globals (`globals: true`).");
  }

  let handle: TestSchema | undefined;
  g.beforeAll(async () => {
    handle = await createTestSchema();
  });
  g.afterAll(async () => {
    if (handle === undefined) return;
    try {
      await dropTestSchema(handle);
    } finally {
      handle = undefined;
    }
  });
  return {
    getPrisma() {
      if (handle === undefined) {
        throw new Error(
          "[db/test-harness] PrismaClient unavailable — useTestSchema() must run inside a `describe`.",
        );
      }
      return handle.prisma;
    },
    getSchema() {
      if (handle === undefined) {
        throw new Error(
          "[db/test-harness] schema unavailable — useTestSchema() must run inside a `describe`.",
        );
      }
      return handle.schema;
    },
  };
}
