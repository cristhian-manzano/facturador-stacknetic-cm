/**
 * `ErrorCodes` — single source of truth for the `ProblemDetail.code`
 * string taxonomy (SPEC-0006 §6.7, REVIEW-0006 §10 #3).
 *
 * Why this exists:
 *
 *   - `ProblemDetail.code` validates against a regex
 *     (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`). The regex catches
 *     malformed names but NOT typos or invented codes — `tenent.forbidden`
 *     passes the regex and silently differs from `tenant.forbidden`.
 *   - Front-end branching on the code (e.g. "show CSRF banner") becomes
 *     unsafe without a known finite list. The web app today checks
 *     `code === "auth.csrf_invalid"` in a couple places and a server
 *     typo would break the UX without surfacing.
 *   - `AppError` subclasses (`@facturador/utils/errors`) already encode a
 *     `code` per class informally. Centralising the strings here means
 *     server + client both reference the SAME identifier.
 *
 * How to extend:
 *
 *   1. Add the new constant. Use `dotted.snake_case` per the regex.
 *   2. Reference it from the throwing site AND from any UI branch that
 *      cares.
 *   3. If the new code is a NEW PROBLEM CATEGORY (not a refinement of
 *      an existing one), add a comment header documenting the boundary.
 *
 * Why `as const` + indexed type (and NOT a TS `enum`):
 *
 *   - `enum` would compile to a runtime object (we don't need that —
 *     callers want the underlying string at JSON wire-time).
 *   - `const enum` is forbidden in `verbatimModuleSyntax` mode.
 *   - The current shape gives us autocomplete on the names AND lets
 *     consumers narrow on the value-string at compile time.
 */

export const ErrorCodes = {
  // ---------------------------------------------------------------------
  // Validation — request-body or query-string failed Zod parsing.
  // ---------------------------------------------------------------------
  VALIDATION_FAILED: "validation.failed",

  // ---------------------------------------------------------------------
  // Auth — session, credentials, CSRF, rate-limits.
  // ---------------------------------------------------------------------
  AUTH_UNAUTHENTICATED: "auth.unauthenticated",
  AUTH_INVALID_CREDENTIALS: "auth.invalid_credentials",
  AUTH_RATE_LIMITED: "auth.rate_limited",
  AUTH_CSRF_INVALID: "auth.csrf_invalid",

  // ---------------------------------------------------------------------
  // Tenant / RBAC — multi-tenant guards.
  // ---------------------------------------------------------------------
  TENANT_FORBIDDEN: "tenant.forbidden",
  TENANT_NO_MEMBERSHIP: "tenant.no_membership",

  // ---------------------------------------------------------------------
  // Conflict / domain concurrency.
  // ---------------------------------------------------------------------
  CONFLICT: "conflict",
  SECUENCIAL_EXHAUSTED_RETRIES: "secuencial.exhausted_retries",
  SECUENCIAL_OVERFLOW: "invoice.sequential_overflow",
  SRI_INVALID_TRANSITION: "sri.invalid_transition",
  SRI_DOCUMENT_NOT_FOUND: "sri_document.not_found",
  SRI_SERVICE_TOKEN_INVALID: "sri.service_token_invalid",

  // ---------------------------------------------------------------------
  // Business — domain rules other than RBAC / concurrency.
  // ---------------------------------------------------------------------
  BUSINESS_RULE_VIOLATION: "business_rule_violation",
  REISSUE_REQUIRED: "reissue_required",
  REISSUE_NOT_ALLOWED: "reissue_not_allowed",
  CUSTOMER_USE_HELPER: "customer.use_helper",
  CUSTOMER_CF_IMMUTABLE: "customer.consumidor_final_immutable",

  // ---------------------------------------------------------------------
  // Upstream — anything outside our control (SRI SOAP, KMS, etc.).
  // ---------------------------------------------------------------------
  UPSTREAM_FAILURE: "upstream_failure",

  // ---------------------------------------------------------------------
  // Internal — last-resort code surfaced when nothing more specific
  // applies. The middleware MUST always set this to "internal.unexpected"
  // before serialising (no leaks of internal class names).
  // ---------------------------------------------------------------------
  INTERNAL_UNEXPECTED: "internal.unexpected",
} as const;

/**
 * Type union of every code value in `ErrorCodes`. Use this anywhere you
 * want compile-time exhaustiveness on the wire string:
 *
 *   ```ts
 *   function isUnauthenticated(code: ErrorCode): boolean { ... }
 *   ```
 *
 * The `(typeof ErrorCodes)[keyof typeof ErrorCodes]` form gives us the
 * STRING-literal union, NOT the symbol keys — what the wire actually
 * carries.
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
