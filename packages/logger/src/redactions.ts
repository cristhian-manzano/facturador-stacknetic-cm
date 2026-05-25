/**
 * `REDACT_PATHS` — canonical list of log paths that Pino must mask with
 * `[REDACTED]`. This list is **extend-only**; entries are never removed
 * (PROMPT-0006 hard constraints + TASKS-0006 hard rules).
 *
 * Source of truth:
 *   - SPEC-0006 §6.3 (canonical list).
 *   - PLAN-0006 §4 Phase 2 (the entries that must be present).
 *   - ai/context/security.md §Logging (do-not-log list).
 *   - PROMPT-0006 §6 (security policy).
 *
 * Pino path syntax recap:
 *   - `req.headers.authorization` — exact path on the root log object.
 *   - `*.password` — any key named `password` at any nesting level.
 *     (Pino fast-redact uses `*` as a single wildcard that matches one
 *     property segment; it walks recursively at the leaf level only when
 *     wrapped via `**` — Pino does NOT expose `**`, but `*.field` covers
 *     the immediate-child case which is what callers control.)
 *   - Bracketed access `res.headers['set-cookie']` for keys that contain
 *     hyphens.
 *
 * If a new sensitive field is introduced anywhere in the codebase, it MUST
 * be added here in the same PR. Failure to do so is a security defect.
 */

/**
 * Read-only array of Pino redaction paths. Exported as a regular array
 * (Pino accepts `string[]`); the freeze guards against accidental in-app
 * mutation that would silently reduce coverage at runtime.
 *
 * Each sensitive key is declared twice when it might appear either at the
 * root of a log payload OR nested inside another object. Pino's fast-redact
 * wildcard (`*.field`) only matches the first nested level; the bare `field`
 * matches the root. This dual-form is the reason the list is large.
 */
export const REDACT_PATHS = Object.freeze([
  // -- Auth / session ----------------------------------------------------
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "passwordHash",
  "passphrase",
  "csrfSecret",
  "csrfTokenHash",
  "sessionId",
  "*.password",
  "*.passwordHash",
  "*.passphrase",
  "*.csrfSecret",
  "*.csrfTokenHash",
  "*.sessionId",

  // -- Certificates (must never appear in any log) ----------------------
  "p12",
  "p12Buffer",
  "pfx",
  "pem",
  "privateKey",
  "certificatePassphrase",
  "*.p12",
  "*.p12Buffer",
  "*.pfx",
  "*.pem",
  "*.privateKey",
  "*.certificatePassphrase",

  // -- SRI payloads (full XML carries customer PII + signature) ---------
  "signedXml",
  "xml",
  "rawSoapResponse",
  "claveAcceso",
  "autorizadoXml",
  "authorizedXml",
  "*.signedXml",
  "*.xml",
  "*.rawSoapResponse",
  "*.claveAcceso",
  "*.autorizadoXml",
  "*.authorizedXml",

  // -- Personally identifiable taxpayer data ----------------------------
  "cedula",
  "identificacionComprador",
  "razonSocialComprador",
  "email",
  "telefono",
  "direccionComprador",
  "*.cedula",
  "*.identificacionComprador",
  "*.razonSocialComprador",
  "*.email",
  "*.telefono",
  "*.direccionComprador",

  // -- Cross-service / env-style secrets --------------------------------
  "SESSION_COOKIE_SECRET",
  "SERVICE_JWT_SECRET",
  "SRI_CERT_MASTER_KEY_HEX",
  "*.SESSION_COOKIE_SECRET",
  "*.SERVICE_JWT_SECRET",
  "*.SRI_CERT_MASTER_KEY_HEX",
] as const) satisfies readonly string[];
