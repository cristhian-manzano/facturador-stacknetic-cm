/**
 * `userFactory` — synthetic User fixture for `@facturador/api` tests.
 *
 * Hard rules (PROMPT-0007 §6 / TASKS-0007 §5):
 *
 *   - All emails end in `@facturador.test`.
 *   - Passwords are random non-production-looking strings;
 *     `Fixture_${randomBytes(8).toString("hex")}` per the prompt.  Tests that
 *     need to verify password hashing should call `argon2.hash` on this
 *     value themselves — the fixture does NOT precompute a hash because
 *     argon2 is too slow to run per-fixture-call.
 *   - DisplayName is generic and not derived from any real customer.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { UserPublic } from "@facturador/contracts/auth";
import { EmailSchema, UlidSchema } from "@facturador/contracts/primitives";
import { newId } from "./_ids.js";

// Local shape mirrors `UserPublicSchema` (which isn't exported). Used to
// round-trip the fixture through Zod so the result carries brand types.
const UserPublicShape = z.object({
  id: UlidSchema,
  email: EmailSchema,
  displayName: z.string().min(1).max(200),
});

export interface UserFixture {
  id: string;
  email: string;
  /** Plaintext password — NEVER persist this; hash via argon2 first. */
  password: string;
  displayName: string;
  locale: string;
  isSuperadmin: boolean;
}

let userCounter = 0;

/** Random suffix used to keep email + password unique across calls. */
function uniqueSuffix(): string {
  userCounter += 1;
  return `${String(userCounter).padStart(4, "0")}-${randomBytes(4).toString("hex")}`;
}

export function userFactory(overrides: Partial<UserFixture> = {}): UserFixture {
  const suffix = overrides.email === undefined ? uniqueSuffix() : "";
  return {
    id: newId(),
    email: `user-${suffix}@facturador.test`,
    password: `Fixture_${randomBytes(8).toString("hex")}`,
    displayName: "Fixture User",
    locale: "es-EC",
    isSuperadmin: false,
    ...overrides,
  };
}

/** Project to the wire-shaped `UserPublic` (no password, no hash). */
export function userToPublic(u: UserFixture): UserPublic {
  // Round-trip through the shared shape so brand types are preserved.
  return UserPublicShape.parse({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
  });
}
