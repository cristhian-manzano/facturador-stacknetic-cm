/**
 * Tests for `AmbienteSchema`. Per TASKS-0005 §2.10.
 */
import { describe, expect, it } from "vitest";

import { AmbienteSchema } from "./ambiente.js";

describe("AmbienteSchema", () => {
  it("accepts '1' (pruebas)", () => {
    expect(AmbienteSchema.parse("1")).toBe("1");
  });

  it("accepts '2' (producción)", () => {
    expect(AmbienteSchema.parse("2")).toBe("2");
  });

  it.each([
    ["number 1", 1],
    ["number 2", 2],
    ["string 3", "3"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(AmbienteSchema.safeParse(value).success).toBe(false);
  });
});
