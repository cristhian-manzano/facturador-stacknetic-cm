/**
 * Sync test (REVIEW-0044 §6): every permission referenced from the web
 * `INVOICE_ACTION_PERMISSIONS` map MUST exist in the server-side RBAC
 * matrix. The test imports BOTH so build-time drift is caught.
 *
 * If you add an entry to `INVOICE_ACTION_PERMISSIONS` that doesn't exist
 * in `ALL_ACTIONS`, this test fails.
 *
 * If you remove an action from the server matrix without updating the
 * web map, this test still passes (the web stays a SUBSET of the server)
 * — but the corresponding action button will silently never appear. The
 * compile-time `satisfies` constraint on `INVOICE_ACTION_PERMISSIONS`
 * catches THAT direction at the TypeScript level.
 */
import { describe, expect, it } from "vitest";

import { ALL_ACTIONS, type Action } from "@facturador/utils/rbac";

import { INVOICE_ACTION_PERMISSIONS } from "./permissions.js";

describe("INVOICE_ACTION_PERMISSIONS", () => {
  it("is a subset of the server RBAC MATRIX (ALL_ACTIONS)", () => {
    const serverSet = new Set<Action>(ALL_ACTIONS);
    const webValues = Object.values(INVOICE_ACTION_PERMISSIONS);
    for (const action of webValues) {
      expect(serverSet.has(action)).toBe(true);
    }
  });

  it("covers every action button rendered in <ActionsBar />", () => {
    // The keys MUST stay aligned with the button list in
    // `apps/web/src/invoices/detail/actions-bar.tsx`. Adding a button
    // without updating this map breaks the build (no permission gate).
    expect(Object.keys(INVOICE_ACTION_PERMISSIONS).sort()).toEqual(
      ["delete", "downloadXml", "edit", "printRide", "refresh", "reissue", "retryEmit"].sort(),
    );
  });
});
