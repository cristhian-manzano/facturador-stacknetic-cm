/**
 * Exhaustive RBAC matrix test.
 *
 * Per TASKS-0011 §1.1 + PLAN-0011 §4 (Phase 4 unit), this test iterates
 * EVERY action × EVERY role pair and asserts that `can(role, action)`
 * matches the row in `MATRIX`. If a future PR forgets to add a row, the
 * test fails because the action exists in the `ALL_ACTIONS` array but the
 * matrix lookup returns `undefined`, which `can()` collapses to `false` —
 * and the assertion that "the table says YES" then fails for any role
 * that should have been allowed.
 *
 * Strategy:
 *   - Iterate `ALL_ACTIONS` and `ALL_ROLES` (exposed for this purpose).
 *   - Compute the expected outcome from `MATRIX` directly (the table is the
 *     authority — the test asserts `can()` is a faithful reflection of it).
 *   - Cross-check `actionsForRole` returns the matching set.
 *
 * The test also asserts a few hand-picked invariants that catch dangerous
 * regressions early (OWNER always allowed; VIEWER never allowed to mutate).
 */
import { describe, expect, it } from "vitest";

import {
  ALL_ACTIONS,
  ALL_ROLES,
  MATRIX,
  actionsForRole,
  can,
  type Action,
  type Role,
} from "./rbac.js";

describe("RBAC matrix — exhaustive", () => {
  it("MATRIX has a row for every action in ALL_ACTIONS", () => {
    for (const action of ALL_ACTIONS) {
      expect(MATRIX[action]).toBeDefined();
    }
  });

  it("MATRIX has no extra rows beyond ALL_ACTIONS", () => {
    const matrixKeys = Object.keys(MATRIX).sort();
    const expectedKeys = [...ALL_ACTIONS].sort();
    expect(matrixKeys).toEqual(expectedKeys);
  });

  it("can(role, action) reflects MATRIX for every (role × action) pairing", () => {
    for (const action of ALL_ACTIONS) {
      const allowed = MATRIX[action];
      for (const role of ALL_ROLES) {
        const expected = allowed.includes(role);
        const actual = can(role, action);
        expect(actual, `can(${role}, ${action}) → expected ${String(expected)} per matrix`).toBe(
          expected,
        );
      }
    }
  });

  it("OWNER is allowed on every action (founder safety)", () => {
    for (const action of ALL_ACTIONS) {
      expect(can("OWNER", action), `OWNER must own ${action}`).toBe(true);
    }
  });

  it("VIEWER is never allowed to create/update/delete/emit/reissue/manage", () => {
    const writeVerbs = new Set([
      "create",
      "update",
      "delete",
      "emit",
      "reissue",
      "manage",
      "manage_members",
    ]);
    for (const action of ALL_ACTIONS) {
      const parts = action.split(".");
      const verb = parts[parts.length - 1] ?? "";
      if (writeVerbs.has(verb)) {
        expect(can("VIEWER", action), `VIEWER must not perform ${action}`).toBe(false);
      }
    }
  });

  it("VIEWER is allowed on every .read action", () => {
    for (const action of ALL_ACTIONS) {
      if (action.endsWith(".read")) {
        expect(can("VIEWER", action), `VIEWER must read ${action}`).toBe(true);
      }
    }
  });

  it("ACCOUNTANT cannot manage members or certificates", () => {
    expect(can("ACCOUNTANT", "tenant.manage_members")).toBe(false);
    expect(can("ACCOUNTANT", "certificate.manage")).toBe(false);
    expect(can("ACCOUNTANT", "establecimiento.manage")).toBe(false);
  });

  it("tenant.update is OWNER-only (SPEC-0011 §FR-5; production-readiness)", () => {
    // The matrix is the source of truth for the SPA's `can()` predicate;
    // the server may opt-in to ADMIN-can-update via the
    // `RBAC_ADMIN_CAN_UPDATE_TENANT` env flag, but that override lives in
    // `requirePermission`, not here. The matrix MUST stay OWNER-only.
    expect(can("OWNER", "tenant.update")).toBe(true);
    expect(can("ADMIN", "tenant.update")).toBe(false);
    expect(can("ACCOUNTANT", "tenant.update")).toBe(false);
    expect(can("OPERATOR", "tenant.update")).toBe(false);
    expect(can("VIEWER", "tenant.update")).toBe(false);
  });

  it("OPERATOR cannot reissue invoices or manage certificates", () => {
    expect(can("OPERATOR", "invoice.reissue")).toBe(false);
    expect(can("OPERATOR", "certificate.manage")).toBe(false);
    expect(can("OPERATOR", "tenant.manage_members")).toBe(false);
  });

  it("returns false for an action not present in the matrix (defensive)", () => {
    // The type system bans this at compile time; the cast exists so the
    // runtime predicate is also defensive — a future caller in `apps/web`
    // might pass a string from a URL.
    const bogus = "not_a_real_action" as unknown as Action;
    expect(can("OWNER", bogus)).toBe(false);
  });
});

describe("actionsForRole", () => {
  it("returns every action permitted for OWNER (which is all of them)", () => {
    const owner = actionsForRole("OWNER");
    expect([...owner].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("returns only .read actions for VIEWER", () => {
    const viewer = actionsForRole("VIEWER");
    for (const action of viewer) {
      expect(action.endsWith(".read"), `VIEWER granted non-read ${action}`).toBe(true);
    }
    // And it includes every .read action.
    const expectedReads = ALL_ACTIONS.filter((a) => a.endsWith(".read"));
    expect([...viewer].sort()).toEqual(expectedReads.sort());
  });

  it("is stable: same role → same array (order-equivalent)", () => {
    const a = actionsForRole("ADMIN");
    const b = actionsForRole("ADMIN");
    expect(a).toEqual(b);
  });

  it("returns a subset of ALL_ACTIONS for every role", () => {
    for (const role of ALL_ROLES) {
      const granted = new Set<Action>(actionsForRole(role));
      for (const action of granted) {
        expect(ALL_ACTIONS.includes(action)).toBe(true);
      }
    }
  });

  it("matches can() for every (role × action) pair", () => {
    for (const role of ALL_ROLES) {
      const granted = new Set<Action>(actionsForRole(role));
      for (const action of ALL_ACTIONS) {
        expect(granted.has(action)).toBe(can(role, action));
      }
    }
  });
});

describe("Type-system invariants", () => {
  it("ALL_ROLES enumerates every Role literal", () => {
    // If a future role is added to the union but not to ALL_ROLES, the
    // exhaustive matrix test above passes (because matrix iteration would
    // skip it) — so we additionally assert here that every Role literal
    // is in `ALL_ROLES`.
    const allRoles: readonly Role[] = ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"];
    expect([...allRoles].sort()).toEqual([...ALL_ROLES].sort());
  });
});
