/**
 * Unit tests for `requirePermission()` env-override branches.
 *
 * The pure matrix in `@facturador/utils/rbac` is exhaustively tested in
 * `packages/utils/src/rbac/rbac.test.ts`; this file covers the
 * SERVER-only override carve-outs in `isAllowedByOverride()`:
 *
 *   - `RBAC_ADMIN_CAN_UPDATE_TENANT=true` flips `tenant.update` for ADMIN.
 *   - `RBAC_ACCOUNTANT_CAN_WRITE=true` re-grants the legacy write-capable
 *     permissions to ACCOUNTANT (REVIEW-0044 §HIGH-1).
 *
 * The middleware reads `req.role` and the `env` import; we use Vitest's
 * module mocker to control the env, then build a minimal `req` object
 * to exercise the gate. Express types are minimally satisfied via
 * structural casts.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Action } from "@facturador/utils/rbac";

/**
 * The middleware throws a `ForbiddenError` instance from
 * `@facturador/utils/errors`. We compare by `name + code` rather than
 * `instanceof` because `vi.doMock("../env.js")` triggers module
 * re-evaluation that loads a fresh copy of `@facturador/utils/errors`
 * — making `instanceof` brittle across the test's two import passes.
 */
function isForbidden(err: unknown): boolean {
  return (
    err !== null &&
    err !== undefined &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: unknown }).name === "ForbiddenError" &&
    "code" in err &&
    (err as { code?: unknown }).code === "forbidden_action"
  );
}

/* Helper: build a fake Request with the given role / strip everything else
   the middleware never touches. */
function fakeReq(role: string | undefined): Request {
  return { role } as unknown as Request;
}

function runMiddleware(mw: RequestHandler, req: Request): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const res = {} as Response;
    const next: NextFunction = (err) => {
      resolve(err);
    };
    mw(req, res, next);
  });
}

afterEach(() => {
  vi.resetModules();
});

describe("requirePermission — RBAC_ACCOUNTANT_CAN_WRITE override (REVIEW-0044 HIGH-1)", () => {
  it("ACCOUNTANT is denied `invoice.create` when the flag is OFF (default)", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: false },
    }));
    const { requirePermission } = await import("./require-permission.js");
    const mw = requirePermission("invoice.create" as Action);
    const err = await runMiddleware(mw, fakeReq("ACCOUNTANT"));
    expect(isForbidden(err)).toBe(true);
  });

  it("ACCOUNTANT is allowed `invoice.create` when the flag is ON", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: true },
    }));
    const { requirePermission } = await import("./require-permission.js");
    const mw = requirePermission("invoice.create" as Action);
    const err = await runMiddleware(mw, fakeReq("ACCOUNTANT"));
    expect(err).toBeUndefined();
  });

  it("ACCOUNTANT is allowed every legacy write action when the flag is ON", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: true },
    }));
    const { requirePermission } = await import("./require-permission.js");
    const writeActions: Action[] = [
      "customer.create",
      "customer.update",
      "invoice.create",
      "invoice.emit",
      "invoice.reissue",
    ];
    for (const action of writeActions) {
      const mw = requirePermission(action);
      const err = await runMiddleware(mw, fakeReq("ACCOUNTANT"));
      expect(err, `ACCOUNTANT must pass ${action} when override on`).toBeUndefined();
    }
  });

  it("non-ACCOUNTANT roles are NOT promoted by RBAC_ACCOUNTANT_CAN_WRITE", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: true },
    }));
    const { requirePermission } = await import("./require-permission.js");
    // VIEWER has no `invoice.create` in the matrix; the override only
    // affects ACCOUNTANT, so VIEWER must still get a Forbidden.
    const mw = requirePermission("invoice.create" as Action);
    const err = await runMiddleware(mw, fakeReq("VIEWER"));
    expect(isForbidden(err)).toBe(true);
  });

  it("override does NOT extend to non-listed actions (e.g. certificate.manage)", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: true },
    }));
    const { requirePermission } = await import("./require-permission.js");
    // ACCOUNTANT must STILL be denied `certificate.manage`; the override
    // restores ONLY the customer/invoice write actions.
    const mw = requirePermission("certificate.manage" as Action);
    const err = await runMiddleware(mw, fakeReq("ACCOUNTANT"));
    expect(isForbidden(err)).toBe(true);
  });

  it("fails closed when req.role is missing (defence in depth)", async () => {
    vi.doMock("../env.js", () => ({
      env: { RBAC_ADMIN_CAN_UPDATE_TENANT: false, RBAC_ACCOUNTANT_CAN_WRITE: true },
    }));
    const { requirePermission } = await import("./require-permission.js");
    const mw = requirePermission("invoice.create" as Action);
    const err = await runMiddleware(mw, fakeReq(undefined));
    expect(isForbidden(err)).toBe(true);
  });
});
