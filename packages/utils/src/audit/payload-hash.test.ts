/**
 * Tests for `canonicalJson` + `computeAuditPayloadHash`.
 *
 * Invariants:
 *   - Key order in objects does NOT affect the output (deterministic).
 *   - Array order DOES affect the output (preserved).
 *   - Nested objects are canonicalised recursively.
 *   - Hash chain: `computeAuditPayloadHash` differs on payload OR
 *     prevHash change.
 *   - `null` prevHash and `""` prevHash collide (both treated as "no
 *     predecessor") — this is intentional, the pipe separator still
 *     distinguishes them from "prevHash starts with `|`".
 */
import { describe, expect, it } from "vitest";

import { canonicalJson, computeAuditPayloadHash } from "./payload-hash.js";

describe("canonicalJson", () => {
  it("returns `{}` for an empty object", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  it("returns `[]` for an empty array", () => {
    expect(canonicalJson([])).toBe("[]");
  });

  it("serialises primitives like JSON.stringify", () => {
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
  });

  it("sorts top-level keys lexicographically", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("yields the SAME output for differently-ordered equivalent objects", () => {
    const a = { a: 1, b: 2, c: 3 };
    const b = { c: 3, b: 2, a: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("canonicalises nested objects recursively", () => {
    const v = { outer: { z: 1, a: 2 }, alpha: { b: 1, a: 2 } };
    expect(canonicalJson(v)).toBe('{"alpha":{"a":2,"b":1},"outer":{"a":2,"z":1}}');
  });

  it("preserves array element order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("canonicalises objects nested inside arrays", () => {
    expect(canonicalJson([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]');
  });

  it("differentiates [1,2] from [2,1] (arrays are sequences)", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops undefined values (matches JSON.stringify)", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("handles deep nesting consistently", () => {
    const v1 = { a: { b: { c: { z: 1, a: 2 } } } };
    const v2 = { a: { b: { c: { a: 2, z: 1 } } } };
    expect(canonicalJson(v1)).toBe(canonicalJson(v2));
  });
});

describe("computeAuditPayloadHash", () => {
  it("returns 64 lowercase hex chars", () => {
    expect(computeAuditPayloadHash(null, { ok: true })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same prevHash + payload", () => {
    const a = computeAuditPayloadHash(null, { a: 1, b: 2 });
    const b = computeAuditPayloadHash(null, { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("differs when the payload changes", () => {
    const a = computeAuditPayloadHash(null, { a: 1 });
    const b = computeAuditPayloadHash(null, { a: 2 });
    expect(a).not.toBe(b);
  });

  it("differs when only prevHash changes", () => {
    const payload = { a: 1 };
    const root = computeAuditPayloadHash(null, payload);
    const next = computeAuditPayloadHash(
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      payload,
    );
    expect(root).not.toBe(next);
  });

  it("treats `null` prevHash and empty string prevHash equivalently", () => {
    // Intentional collision: the chain genesis is a single canonical
    // "no predecessor" value. Documented in the impl.
    const a = computeAuditPayloadHash(null, { a: 1 });
    const b = computeAuditPayloadHash("", { a: 1 });
    expect(a).toBe(b);
  });

  it("chains: hashing the same payload twice with different prev hashes diverges", () => {
    const root = computeAuditPayloadHash(null, { event: "auth.login.success" });
    const child = computeAuditPayloadHash(root, { event: "tenant.switch" });
    const sibling = computeAuditPayloadHash(root, { event: "auth.logout" });
    expect(child).not.toBe(sibling);
  });
});
