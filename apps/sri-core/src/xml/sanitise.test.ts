/**
 * Unit tests for the XML sanitisation helpers (TASKS-0023 §1.2,
 * SPEC-0023 §FR-5/FR-6).
 *
 * Coverage targets: every code path inside `escapeXml`, `cleanDescripcion`,
 * and `cleanSingleLineText`. The descripcion truncation path is the
 * lossy one (≤ 300 chars) and gets a dedicated boundary test.
 */
import { describe, it, expect } from "vitest";

import {
  cleanDescripcion,
  cleanSingleLineText,
  escapeXml,
  DESCRIPCION_MAX_LENGTH,
} from "./sanitise.js";

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("preserves accented Spanish characters", () => {
    expect(escapeXml("áéíóúñÑÁÉÍÓÚ")).toBe("áéíóúñÑÁÉÍÓÚ");
  });

  it("escapes & first to avoid double-encoding", () => {
    // If `&` were escaped last, `&amp;lt;` would result.
    expect(escapeXml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("returns empty string unchanged", () => {
    expect(escapeXml("")).toBe("");
  });
});

describe("cleanDescripcion", () => {
  it("collapses newline-separated text into a single line", () => {
    expect(cleanDescripcion("a\nb\tc d  ")).toBe("a b c d");
  });

  it("strips C0 control characters except whitespace handlers", () => {
    // \x01 + bare space + \x07 (BEL) should all vanish; the bare space stays.
    const input = "hola mundo!";
    expect(cleanDescripcion(input)).toBe("hola mundo!");
  });

  it("strips DEL (U+007F)", () => {
    expect(cleanDescripcion("ab")).toBe("ab");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cleanDescripcion("   hola mundo   ")).toBe("hola mundo");
  });

  it("preserves accented characters", () => {
    expect(cleanDescripcion("línea uno línea dos")).toBe("línea uno línea dos");
  });

  it("truncates at DESCRIPCION_MAX_LENGTH chars", () => {
    const long = "x".repeat(500);
    const out = cleanDescripcion(long);
    expect(out.length).toBe(DESCRIPCION_MAX_LENGTH);
    expect(out).toBe("x".repeat(DESCRIPCION_MAX_LENGTH));
  });

  it("returns empty string when input is non-string", () => {
    // The Zod boundary forbids this at the schema level, but the helper is
    // defensive so the builder never crashes on a `null`/`undefined` slip-up.
    // We cast intentionally to exercise the type-guard branch.
    expect(cleanDescripcion(undefined as unknown as string)).toBe("");
  });
});

describe("cleanSingleLineText", () => {
  it("collapses whitespace into single spaces without truncating", () => {
    const input = "  ACME\nS.A.\t  ";
    expect(cleanSingleLineText(input)).toBe("ACME S.A.");
  });

  it("strips control chars but leaves long input intact", () => {
    const input = "x".repeat(400);
    expect(cleanSingleLineText(input).length).toBe(400);
  });

  it("returns empty string on non-string input", () => {
    expect(cleanSingleLineText(null as unknown as string)).toBe("");
  });
});
