/**
 * Tests for `TipoEmisionSchema`. Per TASKS-0005 §2.11.
 */
import { describe, expect, it } from "vitest";

import { TipoEmisionSchema } from "./tipo-emision.js";

describe("TipoEmisionSchema", () => {
  it("accepts '1' (normal)", () => {
    expect(TipoEmisionSchema.parse("1")).toBe("1");
  });

  it("rejects '2' (contingencia, deprecated)", () => {
    expect(TipoEmisionSchema.safeParse("2").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(TipoEmisionSchema.safeParse("").success).toBe(false);
  });
});
