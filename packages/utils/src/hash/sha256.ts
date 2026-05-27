/**
 * `@facturador/utils/hash` — deterministic, non-reversible identifiers
 * for security-sensitive PII (IP addresses, email addresses) used by the
 * audit pipeline and the per-email login rate limiter.
 *
 * Why hash at all (SPEC-0006 §6.8, SPEC-0010 §6.4, REVIEW-0010 §6 #2/#4):
 *
 *   - `Session.ip` and `auth.login.failure` audit payloads need to
 *     correlate logins from the same source WITHOUT storing the raw IP
 *     or email — GDPR/privacy concern + reduces the blast radius of a
 *     log/db leak.
 *   - The result MUST be deterministic so two requests from the same IP
 *     produce the same hash (otherwise rate-limit / abuse-detection
 *     queries don't work).
 *
 * Why SHA-256 (and NOT a salted bcrypt/argon2):
 *
 *   - We are NOT verifying a secret — these are PII identifiers that the
 *     server only needs to be able to RE-PRODUCE from the same input.
 *   - argon2/bcrypt are intentionally slow; a per-request salted hash on
 *     every login would dominate the response time.
 *   - SHA-256 is one-way enough for the threat model (audit log leak): an
 *     attacker would have to brute-force the IPv4 keyspace (~4B) per row
 *     to recover the raw IP, which is feasible but per-row, not per-leak.
 *     The trade-off is documented; see SPEC-0010 §6.4 for the discussion.
 *
 * Why a hex digest (and not base64):
 *
 *   - Hex is index-friendly in Postgres (lexicographic ordering matches
 *     numeric ordering) and trivially url-safe.
 *   - The extra 22 bytes vs base64 are dwarfed by the rest of the row.
 *
 * Threat-model NON-claims:
 *   - This is NOT a keyed hash (HMAC). An attacker who steals the hashed
 *     IP column AND knows the SHA-256 algorithm can brute-force IPv4
 *     space. If/when we move to a keyed approach (HMAC with a server
 *     pepper from KMS), the helper signature stays the same.
 */
import { createHash } from "node:crypto";

/**
 * SHA-256 of `s` as a 64-char hex string. UTF-8 encoded.
 *
 * Stable wrapper so callers don't sprinkle `createHash`/`update`/`digest`
 * triplets all over the codebase — and so we can swap the algorithm in
 * one place when the threat model shifts (e.g. switching to HMAC).
 */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Canonical form of an IP address before hashing.
 *
 * Cases we normalise:
 *
 *   - IPv4-mapped IPv6 (`::ffff:127.0.0.1`) → `127.0.0.1`. Express behind
 *     a proxy will set `req.ip` to either form depending on the socket
 *     family; collapsing both to the IPv4 dotted-quad means the same
 *     client always hashes the same.
 *   - IPv6 zone identifier (`fe80::1%eth0`) → `fe80::1`. The zone is
 *     network-interface scoped and meaningless across hops.
 *   - Hex case (`2001:DB8::1`) → lowercase. RFC 5952 §4.3.
 *   - Surrounding whitespace stripped.
 *
 * Cases we DO NOT normalise:
 *
 *   - IPv6 expansion (`::1` vs `0:0:0:0:0:0:0:1`). We pick the SHORT form
 *     by lowercasing and leaving the rest alone — the input from
 *     Node/Express is already in the short form. A bespoke "compress
 *     zeros" pass would be the correct RFC-5952 implementation but is
 *     overkill for the threat model: collisions across notations only
 *     matter if two LEGITIMATE requests use different notations for the
 *     same address, which doesn't happen in the proxied-Express setup.
 */
export function normaliseIp(ip: string): string {
  let v = ip.trim().toLowerCase();
  // Strip zone id (RFC 4007 §11).
  const pct = v.indexOf("%");
  if (pct !== -1) {
    v = v.slice(0, pct);
  }
  // Collapse IPv4-mapped IPv6 prefix (`::ffff:` is the canonical form
  // after lowercasing). Only collapse when the suffix LOOKS like dotted
  // quad — otherwise we'd corrupt a legitimate `::ffff:abcd:1234`.
  if (v.startsWith("::ffff:")) {
    const tail = v.slice("::ffff:".length);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) {
      v = tail;
    }
  }
  return v;
}

/**
 * SHA-256 hex of the normalised IP. Convenience over
 * `sha256Hex(normaliseIp(ip))`.
 */
export function hashIp(ip: string): string {
  return sha256Hex(normaliseIp(ip));
}

/**
 * SHA-256 hex of an email after `trim().toLowerCase()` so casing /
 * leading-trailing whitespace differences collapse.
 *
 * NOT included: normalisation of the local-part (e.g. Gmail's `.`-
 * insensitivity). That's provider-specific and would let an attacker
 * intentionally bypass per-email rate limits by varying the dot pattern;
 * provider-specific quirks belong in a dedicated layer if/when we add
 * them.
 */
export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}
