/**
 * Tests for `@facturador/utils/hash`.
 *
 * Invariants under test:
 *   - Deterministic: same input → same output.
 *   - SHA-256 outputs are exactly 64 hex chars.
 *   - IPv4-mapped IPv6 + zone-id IPv6 collapse to canonical forms.
 *   - Email trim + lowercase.
 *
 * Cross-checked against the openssl reference (the leading SHA-256 of
 * the empty string is well-known and pinned for sanity).
 */
import { describe, expect, it } from "vitest";

import { hashEmail, hashIp, normaliseIp, sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  it("is 64 lowercase hex chars", () => {
    const out = sha256Hex("hello");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the canonical SHA-256 of the empty string", () => {
    // sha256("") === e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });

  it("differs on a single bit-flip in the input", () => {
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });

  it("treats input as UTF-8", () => {
    // "ñ" in UTF-8 is 0xc3 0xb1; "n" is 0x6e. Hashes must differ.
    expect(sha256Hex("ñ")).not.toBe(sha256Hex("n"));
  });
});

describe("normaliseIp", () => {
  it("lowercases hex IPv6", () => {
    expect(normaliseIp("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseIp("  127.0.0.1  ")).toBe("127.0.0.1");
  });

  it("strips IPv6 zone identifiers", () => {
    expect(normaliseIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normaliseIp("fe80::1234:5678%wlan0")).toBe("fe80::1234:5678");
  });

  it("collapses IPv4-mapped IPv6 (`::ffff:`) when the tail is dotted-quad", () => {
    expect(normaliseIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normaliseIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("does NOT collapse `::ffff:` when the tail is hex (not IPv4)", () => {
    expect(normaliseIp("::ffff:abcd:1234")).toBe("::ffff:abcd:1234");
  });

  it("is a no-op for an already canonical IPv4", () => {
    expect(normaliseIp("10.20.30.40")).toBe("10.20.30.40");
  });

  it("handles loopback IPv6", () => {
    expect(normaliseIp("::1")).toBe("::1");
  });
});

describe("hashIp", () => {
  it("returns 64 lowercase hex chars", () => {
    expect(hashIp("127.0.0.1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same IP", () => {
    expect(hashIp("127.0.0.1")).toBe(hashIp("127.0.0.1"));
  });

  it("yields the same hash for IPv4 and its IPv6-mapped form", () => {
    expect(hashIp("127.0.0.1")).toBe(hashIp("::ffff:127.0.0.1"));
  });

  it("yields the same hash regardless of zone id and case", () => {
    expect(hashIp("fe80::1%eth0")).toBe(hashIp("FE80::1"));
  });

  it("yields different hashes for different IPs", () => {
    expect(hashIp("127.0.0.1")).not.toBe(hashIp("127.0.0.2"));
  });
});

describe("hashEmail", () => {
  it("returns 64 lowercase hex chars", () => {
    expect(hashEmail("a@b.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashEmail("a@b.com")).toBe(hashEmail("a@b.com"));
  });

  it("normalises case and surrounding whitespace", () => {
    const a = hashEmail("USER@EXAMPLE.com");
    const b = hashEmail("  user@example.com  ");
    expect(a).toBe(b);
  });

  it("does NOT collapse provider-specific quirks (Gmail dot insensitivity)", () => {
    // user.name@gmail.com and username@gmail.com SHOULD hash differently.
    // Gmail treats them the same but we don't model provider rules here.
    expect(hashEmail("user.name@gmail.com")).not.toBe(hashEmail("username@gmail.com"));
  });

  it("yields different hashes for different emails", () => {
    expect(hashEmail("a@b.com")).not.toBe(hashEmail("a@c.com"));
  });
});
