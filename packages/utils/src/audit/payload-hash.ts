/**
 * `payload-hash.ts` — canonical JSON + hash-chain primitive for the
 * tamper-evident audit log.
 *
 * Why this exists (REVIEW-0006 §10 #6):
 *
 *   - The `AuditLog` row currently stores the JSON payload as-is. A DB
 *     admin (or anyone with write access) can rewrite a row after the
 *     fact and there's no cryptographic proof of tampering.
 *   - The pattern below is the classic Merkle-style hash chain: each row
 *     stores a `payloadHash = SHA-256(prevHash || canonicalJson(payload))`.
 *     Tampering with one row invalidates the chain from that row forward.
 *   - The hash itself does NOT need to be a keyed HMAC: anyone replaying
 *     a forged payload still needs to recompute every downstream hash,
 *     and an external log shipper (e.g. nightly export) detects the
 *     break by re-walking the chain.
 *
 * Why CANONICAL JSON (and not `JSON.stringify` straight):
 *
 *   - `JSON.stringify` preserves insertion order of object keys. Two
 *     equivalent payloads (`{a:1, b:2}` and `{b:2, a:1}`) would produce
 *     different stringifications and therefore different hashes. The
 *     chain would break on legitimate ORM round-trips that re-shuffle
 *     keys.
 *   - We sort keys recursively (depth-first) and PRESERVE array order
 *     (arrays are sequences in JSON — `[1,2]` ≠ `[2,1]`).
 *   - We pin number / boolean / null serialisation to whatever
 *     `JSON.stringify` does (IEEE 754; we don't try to canonicalise
 *     floats — payloads only carry money as strings).
 *
 * Why we don't reuse a third-party "canonical JSON" impl:
 *
 *   - RFC 8785 (JCS) is the obvious choice but pulls a sizable dep that
 *     would force every consumer (api, sri-core) to import it. Our
 *     payloads are small + flat enough that the 20-line recursion below
 *     is the right amount of code.
 */
import { sha256Hex } from "../hash/sha256.js";

/**
 * Serialise `value` with object keys sorted lexicographically (recursive).
 * Arrays preserve their insertion order. The output is valid JSON and
 * deterministic across runs / processes / engines.
 *
 * Caveats:
 *   - `undefined` values inside objects are dropped (same as
 *     `JSON.stringify`). Arrays with `undefined` slots become `null` —
 *     also same as `JSON.stringify`. We don't try to fix these because
 *     the audit payload shape is controlled by the caller, not
 *     user-supplied.
 *   - Functions / symbols are dropped (same as `JSON.stringify`).
 *   - Circular structures throw — caller must pre-sanitise.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, canonicalReplacer(value));
}

/**
 * `JSON.stringify` replacer that returns objects with keys SORTED.
 *
 * Implementation note: a plain replacer can't reorder keys; the
 * stringifier walks them in the order they appear on the object. So we
 * rebuild each object literal with sorted keys before handing it to the
 * serialiser.
 *
 * We accept `_root` so future tweaks (e.g. caching) can branch on it.
 */
function canonicalReplacer(_root: unknown): (key: string, val: unknown) => unknown {
  return (_key, val) => {
    if (val === null || typeof val !== "object") {
      return val;
    }
    if (Array.isArray(val)) {
      // Preserve order; the recursive call will canonicalise each entry.
      return val as unknown[];
    }
    // Plain object: rebuild with sorted keys. Use Object.keys (NOT
    // Reflect.ownKeys) to ignore Symbols, matching JSON's behaviour.
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      // `JSON.stringify` will drop `undefined` automatically; we don't
      // need a guard here.
      sorted[k] = obj[k];
    }
    return sorted;
  };
}

/**
 * Compute the next-row hash in the audit chain.
 *
 *   prevHash: 64-char hex from the previous row, or `null` for the first
 *             row in the chain (genesis).
 *   payload:  the (already-redacted) payload that will be persisted.
 *
 * Returns a 64-char hex digest. The pipe (`|`) separator prevents
 * length-extension ambiguity between empty prevHash and a payload that
 * starts with hex chars — concatenation without a delimiter would let an
 * attacker craft a forged prevHash + payload pair that hashes the same
 * as a legitimate one.
 */
export function computeAuditPayloadHash(prevHash: string | null, payload: unknown): string {
  return sha256Hex(`${prevHash ?? ""}|${canonicalJson(payload)}`);
}
