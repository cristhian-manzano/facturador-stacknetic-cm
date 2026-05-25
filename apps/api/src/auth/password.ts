/**
 * argon2id password hashing service.
 *
 * Source of truth:
 *   - SPEC-0010 §FR-6 + §6.7.
 *   - TASKS-0010 §3.1 / §3.2.
 *   - ai/context/security.md (passwords always hashed).
 *
 * Pinned parameters per OWASP 2024 minimums (and matched verbatim by
 * `packages/db/prisma/seed.ts`, so a seed-hashed password verifies on
 * the API side without re-hashing):
 *
 *   type        = argon2id
 *   memoryCost  = 65_536    (64 MiB)
 *   timeCost    = 3
 *   parallelism = 1
 *
 * DUMMY_HASH:
 *   Pre-computed at module load and exported so the login handler can
 *   keep the timing of an "unknown email" path indistinguishable from
 *   the "known email + bad password" path. The handler calls
 *   `verifyPassword(DUMMY_HASH, submitted)` when the email lookup
 *   missed, paying the same argon2 cost.
 */

import argon2 from "argon2";

/**
 * Pinned argon2id parameters. EXPORTED so tests can assert against the
 * exact values and so other modules (notably the DB seed) can re-use
 * them when they need to mint a hash compatible with this verifier.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

/** Hash a plaintext password with the pinned argon2id parameters. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_PARAMS);
}

/**
 * Verify a plaintext password against a stored hash. Returns `true` on
 * match, `false` on mismatch or any error. We deliberately swallow
 * argon2 parsing errors and treat them as "no match" — leaking the
 * difference between "malformed hash" and "wrong password" would help
 * an attacker probe the DB.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Pre-computed dummy hash used in the constant-time login path. The
 * plaintext value here is irrelevant — what matters is that
 * `verifyPassword(DUMMY_HASH, anything)` performs a full argon2id
 * comparison and returns `false`.
 *
 * Top-level `await` is intentional. This module is ESM (`"type":
 * "module"`) and Node 22 supports it. The price is a ~50 ms warm-up
 * at server boot; the win is a hash that exactly matches our pinned
 * params so timing is identical to a real verify.
 *
 * SECURITY: the literal "dummy_constant_value_for_timing" is NOT a
 * password — it never reaches the wire and its hash is never compared
 * against any user-supplied password (the only call site,
 * `loginHandler`, uses the user's submitted password against THIS
 * hash, and the hash function is one-way).
 */
export const DUMMY_HASH: string = await hashPassword("dummy_constant_value_for_timing");
