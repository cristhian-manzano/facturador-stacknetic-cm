/**
 * Tests for `sweepExpiredSessions`. Per production-readiness §13.
 *
 * Covers:
 *   - Rows whose `expiresAt` is older than 7 days are deleted.
 *   - Rows still within the retention window are kept.
 *   - The function returns the deleted row count.
 *
 * The schedule wiring is exercised at boot time in `server.ts`; we
 * intentionally don't spin up a real cron tick here (vitest hates
 * long-lived timers — see test/setup.ts).
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@facturador/db";

import { sweepExpiredSessions } from "./session-sweep.js";

describe("sweepExpiredSessions", () => {
  it("deletes rows where expiresAt is older than 7 days", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const prisma = { session: { deleteMany } } as unknown as PrismaClient;

    const now = new Date("2026-05-15T00:00:00Z");
    const count = await sweepExpiredSessions(prisma, { now });
    expect(count).toBe(4);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const args = deleteMany.mock.calls[0]?.[0] as {
      where: { expiresAt: { lt: Date } };
    };
    // Cutoff = now − 7 days exactly.
    const cutoff = args.where.expiresAt.lt;
    expect(cutoff.toISOString()).toBe("2026-05-08T00:00:00.000Z");
  });

  it("returns the deleted count even when zero rows match", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { session: { deleteMany } } as unknown as PrismaClient;
    const n = await sweepExpiredSessions(prisma, { now: new Date() });
    expect(n).toBe(0);
  });
});
