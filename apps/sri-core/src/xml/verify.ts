/**
 * `verifySignedXml` — local XAdES-BES signature verification.
 *
 * Source of truth:
 *   - SPEC-0024 §6.5 (verify function) + §FR-7.
 *   - PLAN-0024 §4 Phase 2.
 *   - TASKS-0024 §3.1.
 *
 * Public contract:
 *
 *   ```ts
 *   const { valid, errors } = await verifySignedXml(signedXml);
 *   if (!valid) {
 *     // Surface to the caller. The errors array never contains the
 *     // signed XML body or any PII; it carries algorithm-level reasons.
 *   }
 *   ```
 *
 * Design notes:
 *
 *   - We delegate the heavy lifting to the same internal verifier the
 *     signer uses for its self-check (SPEC-0024 §4 "Local verification
 *     runs INSIDE signFacturaXml"). Re-using one path means a tamper
 *     scenario that fails the signer's preflight also fails this
 *     public-surface call — no class of bug is unique to one entry point.
 *   - The verifier never accesses the filesystem; it operates entirely
 *     on the supplied string. The lifecycle layer is responsible for
 *     blob fetches.
 *   - We never log the signed XML. Callers that want to surface the
 *     `errors` array can pass them through the redacted logger; the
 *     payload is short by design.
 */
import { __internalVerifySignedXml } from "./sign.js";

export interface VerifySignedXmlResult {
  /** `true` when the signature validates against the embedded leaf cert. */
  readonly valid: boolean;
  /**
   * Human-readable failure reasons. Empty when `valid === true`. Strings
   * are short and free of customer / PEM material so they're safe to log.
   */
  readonly errors: readonly string[];
}

/**
 * Run XAdES verification on `signedXml`. Returns the boolean verdict
 * plus a short list of failure reasons.
 *
 * Behaviour:
 *   - Returns `{ valid: false }` (instead of throwing) for any class of
 *     local failure: parse error, missing Signature element, multiple
 *     Signature elements, digest mismatch, signature value mismatch.
 *     This makes the function safe to call from a try-free orchestration
 *     path; throws are reserved for programmer-error cases that the
 *     callers can't recover from.
 */
export async function verifySignedXml(signedXml: string): Promise<VerifySignedXmlResult> {
  const result = await __internalVerifySignedXml(signedXml);
  return { valid: result.valid, errors: Object.freeze([...result.errors]) };
}
