/**
 * Web-side action ↔ permission map (REVIEW-0044 §6).
 *
 * `<ActionsBar />` used to hard-code the permission required for each
 * button. Moving the mapping into a single object makes drift between
 * server (`MATRIX` in `packages/utils/src/rbac/rbac.ts`) and client easy
 * to detect — the unit test in
 * `apps/web/src/auth/permissions.test.ts` asserts that every value in
 * this map exists in `ALL_ACTIONS`.
 *
 * The KEYS of the map are SPA-only labels (used as React keys + test
 * ids). The VALUES are the gating permissions; if the user's
 * `useAuth().permissions` array contains the value, the button is
 * visible.
 */
import type { Action } from "@facturador/utils/rbac";

/**
 * Invoice detail action → required permission.
 *
 * If you add a new action button to `<ActionsBar />`:
 *   1. Add an entry here (label → permission).
 *   2. Use the label as the `key` in the button spec.
 *   3. The exhaustive sync test catches mismatches with the server matrix.
 */
export const INVOICE_ACTION_PERMISSIONS = {
  retryEmit: "invoice.emit",
  edit: "invoice.create",
  delete: "invoice.create",
  reissue: "invoice.reissue",
  refresh: "invoice.read",
  downloadXml: "invoice.read",
  printRide: "invoice.read",
} as const satisfies Readonly<Record<string, Action>>;

export type InvoiceActionKey = keyof typeof INVOICE_ACTION_PERMISSIONS;
