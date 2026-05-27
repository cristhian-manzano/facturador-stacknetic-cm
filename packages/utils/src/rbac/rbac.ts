/**
 * RBAC helper — pure permission matrix.
 *
 * Source of truth:
 *   - SPEC-0011 §6.2 (matrix table).
 *   - PLAN-0011 §3 (architecture decisions + matrix seed).
 *   - TASKS-0011 §1.1.
 *
 * Design goals:
 *   - Single source of truth for "can role X perform action Y?". Routes never
 *     hand-roll role checks; they call `requirePermission(action)` which calls
 *     `can(role, action)`.
 *   - PURE: no I/O, no env lookups. Trivial to test exhaustively.
 *   - Shared between server (`apps/api`) and web (`apps/web`) — the FE uses
 *     `can()` for UI gating; the server is still the authority.
 *   - Adding an action is a 2-line code change: add it to the `Action` union
 *     AND add a row in `MATRIX`. The unit test then fails until both halves
 *     are wired, which is the desired forcing function.
 *
 * Role definitions (mirror the Prisma `Role` enum):
 *   - OWNER       — tenant founder. Full power within the tenant.
 *   - ADMIN       — operational manager. Can configure most things but cannot
 *                   permanently destroy the tenant.
 *   - ACCOUNTANT  — view-only auditor across the board (SPEC-0011 §FR-5 row 3).
 *                   Cannot create/update/delete/emit/reissue anything; the
 *                   role exists so auditors can read the full tenant state
 *                   without altering it. Legacy installs that relied on the
 *                   pre-REVIEW-0044 write-capable matrix can opt in to it via
 *                   `RBAC_ACCOUNTANT_CAN_WRITE=true` (enforced server-side in
 *                   `requirePermission`, NOT in this matrix).
 *   - OPERATOR    — day-to-day invoice issuance. Can manage customers + emit
 *                   invoices, but cannot reissue or manage certificates.
 *   - VIEWER      — read-only.
 *
 * Action naming convention:
 *   - kebab-case namespaced with a dot: `<resource>.<verb>`.
 *   - Verbs: `read`, `create`, `update`, `delete` for CRUD; `manage_members`,
 *     `emit`, `reissue`, `manage` for domain-specific verbs.
 *   - One action per route's required permission; never wildcards.
 */

/**
 * Tenant role. Mirrors the Prisma `Role` enum in `packages/db/prisma/schema.prisma`.
 * If the enum grows or shrinks, this union and the matrix must be updated
 * in lockstep — the type system + the exhaustive matrix test catch drift.
 */
export type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "OPERATOR" | "VIEWER";

/** All roles, in matrix order. Exposed so tests can iterate exhaustively. */
export const ALL_ROLES: readonly Role[] = [
  "OWNER",
  "ADMIN",
  "ACCOUNTANT",
  "OPERATOR",
  "VIEWER",
] as const;

/**
 * Every gated action in the platform. One literal per route requirement.
 *
 * Adding a new action is a 3-step contract:
 *   1. Add the literal to this union.
 *   2. Add a row to `MATRIX` listing the roles that may perform it.
 *   3. The exhaustive test (`rbac.test.ts`) automatically picks it up.
 */
export type Action =
  // Tenant-level (SPEC-0011 §6.2 row 1-3)
  | "tenant.read"
  | "tenant.update"
  | "tenant.manage_members"
  // Customer (later spec wires routes; matrix lives here per PLAN-0011 §3)
  | "customer.read"
  | "customer.create"
  | "customer.update"
  | "customer.delete"
  // Invoice (later spec wires routes)
  | "invoice.read"
  | "invoice.create"
  | "invoice.emit"
  | "invoice.reissue"
  // SRI Core surfaces (later spec wires routes)
  | "certificate.manage"
  | "establecimiento.manage";

/** All actions, in matrix order. Exposed so tests can iterate exhaustively. */
export const ALL_ACTIONS: readonly Action[] = [
  "tenant.read",
  "tenant.update",
  "tenant.manage_members",
  "customer.read",
  "customer.create",
  "customer.update",
  "customer.delete",
  "invoice.read",
  "invoice.create",
  "invoice.emit",
  "invoice.reissue",
  "certificate.manage",
  "establecimiento.manage",
] as const;

/**
 * Permission matrix. `MATRIX[action]` is the (read-only) set of roles that
 * may perform `action`. A role NOT present in the list is denied.
 *
 * Values mirror SPEC-0011 §6.2 verbatim. The OWNER role appears in every row
 * because tenant founders always have full power within their tenant.
 */
export const MATRIX: Readonly<Record<Action, readonly Role[]>> = {
  // Tenant
  "tenant.read": ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"],
  // SPEC-0011 §FR-5: `tenant.update` is OWNER-only by default. Operators
  // who need the legacy ADMIN-can-rename behaviour can set
  // `RBAC_ADMIN_CAN_UPDATE_TENANT=true` in apps/api; that gate is
  // enforced server-side in `requirePermission` (the static matrix here
  // stays OWNER-only so the web SPA's `can()` predicate doesn't surface
  // a Rename button the server would reject).
  "tenant.update": ["OWNER"],
  "tenant.manage_members": ["OWNER", "ADMIN"],
  // Customer — ACCOUNTANT is view-only per SPEC-0011 §FR-5 row 3
  // (REVIEW-0044 HIGH-1). Servers can flip the legacy write-capable
  // behaviour back on via `RBAC_ACCOUNTANT_CAN_WRITE=true`; that
  // override lives in `apps/api/src/auth/require-permission.ts`.
  "customer.read": ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"],
  "customer.create": ["OWNER", "ADMIN", "OPERATOR"],
  "customer.update": ["OWNER", "ADMIN", "OPERATOR"],
  "customer.delete": ["OWNER", "ADMIN"],
  // Invoice — ACCOUNTANT removed from create/emit/reissue (HIGH-1).
  "invoice.read": ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"],
  "invoice.create": ["OWNER", "ADMIN", "OPERATOR"],
  "invoice.emit": ["OWNER", "ADMIN", "OPERATOR"],
  "invoice.reissue": ["OWNER", "ADMIN"],
  // Sensitive
  "certificate.manage": ["OWNER", "ADMIN"],
  "establecimiento.manage": ["OWNER", "ADMIN"],
} as const;

/**
 * Pure predicate: may `role` perform `action`?
 *
 * Total: returns `false` for any unknown action (defensive — TypeScript
 * narrows callers to legal actions, but a runtime caller from `apps/web`
 * might pass a string at compile-time too).
 */
export function can(role: Role, action: Action): boolean {
  const allowed = MATRIX[action];
  // Defensive: TS narrows `action` to legal Action keys, but a runtime
  // caller from the SPA may pass an arbitrary string at the JS boundary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (allowed === undefined) return false;
  return allowed.includes(role);
}

/**
 * Return the (frozen) list of actions a role can perform. Used by the
 * `/me` endpoint to surface `permissions: Action[]` so the SPA can hint
 * which UI elements to gate.
 *
 * Stable order: same as `ALL_ACTIONS`. Tests rely on this for golden values.
 */
export function actionsForRole(role: Role): readonly Action[] {
  return ALL_ACTIONS.filter((action) => can(role, action));
}
