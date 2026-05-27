/**
 * Unit tests for `startExpiryJob` — verifies the scheduler wires the
 * cron expression we expect and triggers `runExpiryCheck` when fired.
 *
 * Strategy: we don't run real cron — we call the underlying
 * `runExpiryCheck` once with a stub prisma and assert the shape of the
 * returned counters. The scheduler wiring is exercised at boot time;
 * here we just confirm the call-through semantics.
 *
 * The advisory-lock concurrency test stubs `$queryRaw` so the helper
 * sees the second invocation as "lock held". A separate integration
 * test against a real Postgres would exercise the actual
 * `pg_try_advisory_lock` path; we keep that out of this file to avoid
 * dragging the test-schema harness into a pure unit test.
 */
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@facturador/logger";

import {
  runExpiryCheck,
  runExpiryCheckBody,
  EXPIRY_JOB_LOCK_NAME,
  EXPIRY_SKIPPED_RESULT,
  EXPIRY_WARNING_BUCKETS,
} from "./expiry-job.js";

function quietLogger() {
  const stream = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: "sri-core", env: "test", destination: stream });
}

describe("expiry-job — buckets and call-through", () => {
  it("publishes the canonical bucket list {30, 15, 7, 3, 1, 0}", () => {
    expect([...EXPIRY_WARNING_BUCKETS]).toEqual([30, 15, 7, 3, 1, 0]);
  });

  it("scans 0 certs cleanly when the DB is empty", async () => {
    const stub = {
      certificate: {
        findMany: () => Promise.resolve([]),
      },
      auditLog: {
        create: () => Promise.resolve({}),
      },
    } as unknown as import("@facturador/db").PrismaClient;
    // `runExpiryCheckBody` skips the advisory-lock dance — same code
    // path we exercised before the punchlist change.
    const result = await runExpiryCheckBody(stub, quietLogger());
    expect(result).toEqual({
      scanned: 0,
      warningsWritten: 0,
      expiredWritten: 0,
    });
  });
});

describe("expiry-job — advisory lock", () => {
  it("exposes a deterministic lock name so two replicas pick the same slot", () => {
    expect(EXPIRY_JOB_LOCK_NAME).toBe("cert-expiry-job");
  });

  it("runs the body when pg_try_advisory_lock returns locked=true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const stub = {
      certificate: { findMany },
      auditLog: { create: () => Promise.resolve({}) },
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    } as unknown as import("@facturador/db").PrismaClient;
    const result = await runExpiryCheck(stub, quietLogger());
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1); // released
    expect(result.scanned).toBe(0);
  });

  it("skips and returns EXPIRY_SKIPPED_RESULT when the lock is already held", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ locked: false }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const stub = {
      certificate: { findMany },
      auditLog: { create: () => Promise.resolve({}) },
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    } as unknown as import("@facturador/db").PrismaClient;
    const result = await runExpiryCheck(stub, quietLogger());
    expect(result).toEqual(EXPIRY_SKIPPED_RESULT);
    expect(findMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled(); // no release when we never acquired
  });

  it("only one of two concurrent calls runs the body (lock semantics)", async () => {
    // Simulate two replicas calling runExpiryCheck at the same instant.
    // The shared stub tracks a single boolean — the first call to
    // queryRaw flips it on (returning locked=true), the second sees it
    // held and returns false. `$executeRaw` releases it.
    let held = false;
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockImplementation(() => {
      if (held) return Promise.resolve([{ locked: false }]);
      held = true;
      return Promise.resolve([{ locked: true }]);
    });
    const executeRaw = vi.fn().mockImplementation(() => {
      held = false;
      return Promise.resolve(1);
    });
    const stub = {
      certificate: { findMany },
      auditLog: { create: () => Promise.resolve({}) },
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    } as unknown as import("@facturador/db").PrismaClient;
    // Fire both calls before awaiting — but the helper still awaits
    // sequentially inside, so the second sees `held = true`.
    const [a, b] = await Promise.all([
      runExpiryCheck(stub, quietLogger()),
      runExpiryCheck(stub, quietLogger()),
    ]);
    // Exactly one body-run; the other was the skipped sentinel.
    const ran = [a, b].filter((r) => r !== EXPIRY_SKIPPED_RESULT);
    const skipped = [a, b].filter((r) => r === EXPIRY_SKIPPED_RESULT);
    expect(ran).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
