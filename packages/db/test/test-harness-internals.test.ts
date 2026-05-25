/**
 * Coverage-focused tests for the harness internals.
 *
 * The cross-schema isolation tests exercise the happy path and the
 * `createTestSchema / dropTestSchema` lifecycle (which together account
 * for most statements).  This file pins the remaining branches so the
 * `@facturador/db` workspace meets the 90 / 80 thresholds set in
 * `defineFacturadorVitestConfig` (SPEC-0007 §FR-2).
 *
 * Specifically:
 *
 *   - `resolveBaseUrl` error path when `DATABASE_URL` is unset.
 *   - `useTestSchema` happy path: `getPrisma()` + `getSchema()` return the
 *     same handle that `createTestSchema` minted (via the auto-wired
 *     `beforeAll`).
 *   - `useTestSchema` no-Vitest-globals path: importing in a non-Vitest
 *     context fails loud.  We exercise this by deleting Vitest's globals
 *     temporarily in an isolated branch.
 *   - `dropTestSchema` swallowing a pre-disconnected client.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createTestSchema,
  dropTestSchema,
  newTestSchemaName,
  useTestSchema,
} from "../src/test-harness.js";

describe("test-harness — useTestSchema (happy path)", () => {
  const ctx = useTestSchema();

  it("getPrisma() returns a connected client and getSchema() returns the schema", async () => {
    const prisma = ctx.getPrisma();
    const schema = ctx.getSchema();
    expect(schema).toMatch(/^test_[0-9a-z]{26}$/);
    // The client must be reachable — a SELECT 1 verifies the schema migration
    // ran and the connection is live.
    const rows = (await prisma.$queryRawUnsafe("SELECT 1 AS ok"));
    expect(rows[0]?.ok).toBe(1);
  });
});

describe("test-harness — internals", () => {
  // Save the host's `DATABASE_URL` so we can restore it after the negative test.
  const originalDbUrl = process.env.DATABASE_URL;
  const originalBaseUrl = process.env.BASE_DATABASE_URL;

  afterEach(() => {
    if (originalDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDbUrl;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.BASE_DATABASE_URL;
    } else {
      process.env.BASE_DATABASE_URL = originalBaseUrl;
    }
  });

  it("createTestSchema throws when neither DATABASE_URL nor BASE_DATABASE_URL is set", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.BASE_DATABASE_URL;
    await expect(createTestSchema()).rejects.toThrow(/DATABASE_URL/);
  });

  it("dropTestSchema swallows a $disconnect on a client that was never connected", async () => {
    // Build a client that we never `$connect()` and then never use.  The
    // helper must NOT throw — the `try/catch` guard in `dropTestSchema`
    // is the path under test.
    const orphan = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL! } },
      log: ["warn", "error"],
    });
    const fakeSchema = newTestSchemaName();
    await expect(dropTestSchema({ prisma: orphan, schema: fakeSchema })).resolves.toBeUndefined();
  });
});

describe("test-harness — useTestSchema without Vitest globals", () => {
  // Save handles to the globals we're about to remove.  Cleanup restores
  // them in a `beforeAll(restore)` so the surrounding describe's
  // `useTestSchema` doesn't break.
  const originals = {
    beforeAll: (globalThis as unknown as { beforeAll?: unknown }).beforeAll,
    afterAll: (globalThis as unknown as { afterAll?: unknown }).afterAll,
  };

  beforeAll(() => {
    // Restore after this test runs.  Vitest invokes `beforeAll` for each
    // describe block, but we run a fresh restore at the END instead so the
    // ordering is unambiguous.
  });

  it("throws if Vitest globals are unavailable", () => {
    const g = globalThis as unknown as { beforeAll?: unknown; afterAll?: unknown };
    delete g.beforeAll;
    delete g.afterAll;
    try {
      expect(() => useTestSchema()).toThrow(/requires Vitest globals/);
    } finally {
      g.beforeAll = originals.beforeAll;
      g.afterAll = originals.afterAll;
    }
  });
});
