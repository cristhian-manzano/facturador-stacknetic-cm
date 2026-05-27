/**
 * Subpath: `@facturador/utils/audit`.
 *
 * Re-exports the `audit` helper plus the `redactPayload` walker used by
 * the audit helper to scrub `payloadJson` before persistence, and the
 * hash-chain primitives used to build tamper-evident audit chains.
 */
export { audit, type AuditDependencies, type AuditInput, type AuditPrismaClient } from "./audit.js";
export { redactPayload, SENSITIVE_KEYS } from "./redact.js";
export { canonicalJson, computeAuditPayloadHash } from "./payload-hash.js";
