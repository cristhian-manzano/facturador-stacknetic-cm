/**
 * Subpath: `@facturador/utils/hash`.
 *
 * Deterministic PII identifiers used by the audit log and the per-email
 * rate limiter. See `sha256.ts` for the threat-model discussion.
 */
export { sha256Hex, normaliseIp, hashIp, hashEmail } from "./sha256.js";
