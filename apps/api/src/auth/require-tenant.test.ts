/**
 * Unit tests for `buildRequireTenant`. Per production-readiness §16.
 *
 * Specifically asserts the "exactly one membership query per request"
 * invariant: a downstream `requirePermission` middleware MUST read
 * `req.role` (the cached value) and never trigger another lookup.
 *
 * We stub Prisma's `membership.findFirst` with a vi.fn so the count is
 * directly observable. The middleware chain runs against a mock
 * Request/Response/next triple — no Express app is needed.
 */
import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@facturador/db";

import { requirePermission } from "./require-permission.js";
import { buildRequireTenant } from "./require-tenant.js";

function makeReq(session: {
  userId: string;
  companyId: string | null;
}): Request {
  return {
    session: {
      id: "01HSESSION0000000000000000",
      userId: session.userId,
      companyId: session.companyId,
      csrfTokenHash: "x",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
    },
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as unknown as Response;
}

describe("requireTenant + requirePermission caching", () => {
  it("runs exactly ONE membership query per request, even with downstream requirePermission", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "01HMEMBER000000000000000000",
      userId: "01HUSER0",
      companyId: "01HCO0",
      role: "OWNER",
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = { membership: { findFirst } } as unknown as PrismaClient;

    const tenantMw = buildRequireTenant({ prisma });
    const permMw = requirePermission("invoice.read");

    const req = makeReq({ userId: "01HUSER0", companyId: "01HCO0" });
    const res = makeRes();

    // Run middlewares in series. `next` is a thin promise so the test
    // observes async completion before moving on.
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (err) => {
        if (err !== undefined) reject(err as Error);
        else resolve();
      };
      void tenantMw(req, res, next);
    });
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (err) => {
        if (err !== undefined) reject(err as Error);
        else resolve();
      };
      permMw(req, res, next);
    });

    // The cache invariant: exactly one DB query happened.
    expect(findFirst).toHaveBeenCalledTimes(1);
    // The middlewares populated req.role / req.companyId / req.membership.
    const reqMid = req as Request & {
      role?: string;
      companyId?: string;
      membership?: { id: string };
    };
    expect(reqMid.role).toBe("OWNER");
    expect(reqMid.companyId).toBe("01HCO0");
    expect(reqMid.membership?.id).toBe("01HMEMBER000000000000000000");
  });

  it("only selects rows where acceptedAt is not null (active-membership filter)", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { membership: { findFirst } } as unknown as PrismaClient;
    const mw = buildRequireTenant({ prisma });

    const req = makeReq({ userId: "01HUSER0", companyId: "01HCO0" });
    const res = makeRes();
    let captured: unknown = undefined;
    await new Promise<void>((resolve) => {
      const next: NextFunction = (err) => {
        captured = err;
        resolve();
      };
      void mw(req, res, next);
    });
    expect(captured).toBeInstanceOf(Error);

    const whereArg = findFirst.mock.calls[0]?.[0] as {
      where: { acceptedAt: { not: null } };
    };
    expect(whereArg.where.acceptedAt).toEqual({ not: null });
  });
});
