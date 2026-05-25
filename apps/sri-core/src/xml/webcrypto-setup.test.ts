/**
 * Tests for `ensureXadesEngine` — the idempotent engine init (TASKS-0024
 * §1.2 validation).
 */
import { describe, expect, it } from "vitest";
import { SignedXml } from "xadesjs";
import { ensureXadesEngine, __resetWebcryptoSetupForTests } from "./webcrypto-setup.js";

describe("ensureXadesEngine", () => {
  it("is callable multiple times without throwing", () => {
    __resetWebcryptoSetupForTests();
    expect(() => ensureXadesEngine()).not.toThrow();
    expect(() => ensureXadesEngine()).not.toThrow();
    expect(() => ensureXadesEngine()).not.toThrow();
  });

  it("after init, `new SignedXml()` constructs without throwing", () => {
    ensureXadesEngine();
    const sxml = new SignedXml();
    expect(sxml).toBeDefined();
  });
});
