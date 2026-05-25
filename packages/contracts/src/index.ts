/**
 * `@facturador/contracts` — root entry.
 *
 * Consumers MUST import via subpath exports
 * (`@facturador/contracts/primitives`, `/auth`, `/tenants`, `/customers`,
 * `/invoices`, `/sri`, `/errors`). The root entry exists only so Node's
 * `exports` resolution has a `"."` target; downstream code should never reach
 * for `import { ... } from "@facturador/contracts"`. Adding new schemas means
 * adding a new subpath, not bloating the root surface.
 *
 * Source of truth: SPEC-0005 §6.1, PLAN-0005 §3, §4.
 */
export {};
