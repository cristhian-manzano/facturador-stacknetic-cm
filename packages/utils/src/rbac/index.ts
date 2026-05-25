/**
 * Subpath: `@facturador/utils/rbac`.
 *
 * Pure permission matrix + `can()` predicate. Imported by `apps/api` for
 * route gating (`requirePermission`) and by `apps/web` for UI hints.
 */
export {
  ALL_ACTIONS,
  ALL_ROLES,
  MATRIX,
  actionsForRole,
  can,
  type Action,
  type Role,
} from "./rbac.js";
