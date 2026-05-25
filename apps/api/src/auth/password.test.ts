/**
 * Unit tests for the argon2id password service (apps/api/src/auth/password.ts).
 *
 * Per TASKS-0010 §3.1 / §3.2 validation step:
 *   - `hashPassword(plain)` produces a non-empty argon2id-format string
 *     and `verifyPassword(hash, plain)` round-trips to true.
 *   - `verifyPassword(hash, wrongPlain)` returns false.
 *   - `verifyPassword(DUMMY_HASH, anything)` returns false but takes a
 *     comparable amount of time (we don't assert a strict timing window
 *     here — that's covered by the integration test in `test/auth.test.ts`).
 *   - `ARGON2_PARAMS` matches the OWASP 2024 minimums verbatim.
 */
import { describe, expect, it } from "vitest";
import argon2 from "argon2";
import { ARGON2_PARAMS, DUMMY_HASH, hashPassword, verifyPassword } from "./password.js";

describe("apps/api/auth/password — ARGON2_PARAMS", () => {
  it("uses the OWASP 2024 minimum argon2id parameters", () => {
    expect(ARGON2_PARAMS).toEqual({
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  });
});

describe("apps/api/auth/password — hash/verify round-trip", () => {
  it("hashPassword produces an argon2id-prefixed digest", async () => {
    const hash = await hashPassword("CorrectHorseBattery!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash.length).toBeGreaterThan(40);
  });

  it("verifyPassword returns true for the same password", async () => {
    const hash = await hashPassword("CorrectHorseBattery!");
    expect(await verifyPassword(hash, "CorrectHorseBattery!")).toBe(true);
  });

  it("verifyPassword returns false for a wrong password", async () => {
    const hash = await hashPassword("CorrectHorseBattery!");
    expect(await verifyPassword(hash, "WrongPasswordWrong!")).toBe(false);
  });

  it("verifyPassword swallows malformed-hash errors as false", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});

describe("apps/api/auth/password — DUMMY_HASH", () => {
  it("is a valid argon2id digest pre-computed at module load", () => {
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
  });

  it("verifies to false against realistic user-supplied passwords", async () => {
    // DUMMY_HASH's underlying plaintext is an in-process constant the user
    // never sees and never sends. For every realistic input, the verify
    // returns false — that's the property the login handler relies on.
    expect(await verifyPassword(DUMMY_HASH, "Anything-A-Real-User-Might-Type-1!")).toBe(false);
    expect(await verifyPassword(DUMMY_HASH, "")).toBe(false);
    expect(await verifyPassword(DUMMY_HASH, "admin-but-wrong")).toBe(false);
  });
});
