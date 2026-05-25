/**
 * Tests for `redactPayload` — the JSON walker used by `audit()` to scrub
 * `payloadJson` before persistence.
 */
import { describe, expect, it } from "vitest";
import { redactPayload, SENSITIVE_KEYS } from "./redact.js";

describe("SENSITIVE_KEYS", () => {
  it("includes every PROMPT-listed sensitive field name", () => {
    for (const key of [
      "password",
      "passwordHash",
      "passphrase",
      "csrfSecret",
      "p12",
      "privateKey",
      "signedXml",
      "claveAcceso",
      "authorization",
      "cookie",
      "set-cookie",
      "SRI_CERT_MASTER_KEY_HEX",
      "SERVICE_JWT_SECRET",
    ]) {
      expect(SENSITIVE_KEYS.has(key)).toBe(true);
    }
  });

  it("masks a cert.uploaded audit payload's passphrase", () => {
    // PROMPT-0021 hard rule: passphrase must never appear in audit rows
    // or logs. This guards against an accidental insertion if a future
    // refactor stops passing the passphrase via header.
    const out = redactPayload({
      action: "cert.uploaded",
      passphrase: "super-secret-12345",
      fingerprintSha256: "abcd",
    }) as Record<string, unknown>;
    expect(out.passphrase).toBe("[REDACTED]");
    expect(out.fingerprintSha256).toBe("abcd");
  });
});

describe("redactPayload", () => {
  it("replaces sensitive top-level fields with [REDACTED]", () => {
    const out = redactPayload({ password: "x", ok: 1 }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.ok).toBe(1);
  });

  it("recursively redacts nested sensitive keys", () => {
    const out = redactPayload({
      user: { email: "user@example.com", name: "ok" },
      cert: { privateKey: "PEM", p12: "bytes" },
    }) as Record<string, Record<string, unknown>>;
    expect(out.user!.email).toBe("[REDACTED]");
    expect(out.user!.name).toBe("ok");
    expect(out.cert!.privateKey).toBe("[REDACTED]");
    expect(out.cert!.p12).toBe("[REDACTED]");
  });

  it("redacts inside arrays of objects", () => {
    const out = redactPayload([
      { password: "a", id: 1 },
      { password: "b", id: 2 },
    ]) as Record<string, unknown>[];
    expect(out[0]?.password).toBe("[REDACTED]");
    expect(out[1]?.password).toBe("[REDACTED]");
    expect(out[0]?.id).toBe(1);
  });

  it("preserves primitive and null values", () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeUndefined();
    expect(redactPayload(42)).toBe(42);
    expect(redactPayload("plain")).toBe("plain");
    expect(redactPayload(true)).toBe(true);
  });

  it("does not mutate the input", () => {
    const input: Record<string, unknown> = { password: "x", ok: 1 };
    redactPayload(input);
    expect(input.password).toBe("x");
  });

  it("converts Date to ISO string", () => {
    const date = new Date("2026-05-20T00:00:00.000Z");
    expect(redactPayload(date)).toBe("2026-05-20T00:00:00.000Z");
  });

  it("strips opaque Map/Set/RegExp values to undefined (JSON-safe)", () => {
    const out = redactPayload({
      m: new Map(),
      s: new Set(),
      r: /abc/,
      ok: 1,
    }) as Record<string, unknown>;
    expect(out.m).toBeUndefined();
    expect(out.s).toBeUndefined();
    expect(out.r).toBeUndefined();
    expect(out.ok).toBe(1);
  });

  it("handles circular references with [Circular]", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const out = redactPayload(a) as Record<string, unknown>;
    expect(out.self).toBe("[Circular]");
  });
});
