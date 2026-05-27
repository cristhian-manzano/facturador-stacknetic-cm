/**
 * Tests for `TipoIdentificacionSchema`. Per TASKS-0005 §2.12.
 */
import { describe, expect, it } from "vitest";

import { TipoIdentificacionSchema } from "./tipo-identificacion.js";

describe("TipoIdentificacionSchema", () => {
  it.each([["04"], ["05"], ["06"], ["07"], ["08"]])("accepts %s", (value) => {
    expect(TipoIdentificacionSchema.parse(value)).toBe(value);
  });

  it.each([
    ["catalog code 01 (DNI not used here)", "01"],
    ["catalog code 09 (unused)", "09"],
    ["empty", ""],
    ["non-digit", "AA"],
  ])("rejects %s", (_label, value) => {
    expect(TipoIdentificacionSchema.safeParse(value).success).toBe(false);
  });
});
