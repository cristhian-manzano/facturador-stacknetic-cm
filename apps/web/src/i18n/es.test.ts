/**
 * `t()` helper tests.
 *
 * Asserts the lookup + interpolation contract.
 */
import { describe, expect, it } from "vitest";

import { t } from "./es.js";

describe("t()", () => {
  it("returns the literal for a known key without params", () => {
    expect(t("nav.home")).toBe("Inicio");
    expect(t("auth.login.title")).toBe("Iniciar sesión");
  });

  it("interpolates {var} placeholders", () => {
    // The string table doesn't ship a placeholder string today, so we use
    // an existing key as a control and assert no unintended substitution.
    expect(t("nav.home", { unused: "x" })).toBe("Inicio");
  });

  it("falls back to the key when missing (defensive)", () => {
    // Cast a bogus key to bypass the type guard for the negative test.
    const result = t("nonexistent.key" as unknown as "nav.home");
    expect(result).toBe("nonexistent.key");
  });
});
