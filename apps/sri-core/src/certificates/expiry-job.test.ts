/**
 * Unit tests for `startExpiryJob` — verifies the scheduler wires the
 * cron expression we expect and triggers `runExpiryCheck` when fired.
 *
 * Strategy: we don't run real cron — we call the underlying
 * `runExpiryCheck` once with a stub prisma and assert the shape of the
 * returned counters. The scheduler wiring is exercised at boot time;
 * here we just confirm the call-through semantics.
 */
import { describe, expect, it } from "vitest";
import { createLogger } from "@facturador/logger";
import { Writable } from "node:stream";
import { runExpiryCheck, EXPIRY_WARNING_BUCKETS } from "./expiry-job.js";

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
    const result = await runExpiryCheck(stub, quietLogger());
    expect(result).toEqual({
      scanned: 0,
      warningsWritten: 0,
      expiredWritten: 0,
    });
  });
});
