/**
 * Tests for `nowInEcuador`.
 *
 * Focus: the helper interprets the given instant in `America/Guayaquil`
 * (UTC-5, no DST). The boundary case is the one the SRI clave-acceso
 * generator cares about: a UTC instant that crosses the EC midnight.
 */
import { describe, expect, it } from "vitest";

import { nowInEcuador } from "./nowInEcuador.js";

describe("nowInEcuador", () => {
  it("maps a UTC instant to the same EC date when comfortably mid-day", () => {
    // 2026-05-19 18:00 UTC == 2026-05-19 13:00 EC. Same calendar day.
    const out = nowInEcuador(new Date(Date.UTC(2026, 4, 19, 18, 0, 0)));
    expect(out).toEqual({ year: 2026, month: 5, day: 19, iso: "2026-05-19" });
  });

  it("rolls back one day when the UTC instant is before 05:00 UTC", () => {
    // 2026-05-19 04:00 UTC == 2026-05-18 23:00 EC. Different calendar day.
    // This is the canonical "midnight wrap" case the SRI clave depends on.
    const out = nowInEcuador(new Date(Date.UTC(2026, 4, 19, 4, 0, 0)));
    expect(out).toEqual({ year: 2026, month: 5, day: 18, iso: "2026-05-18" });
  });

  it("renders right at the EC midnight boundary (00:00 EC == 05:00 UTC)", () => {
    // 2026-05-19 05:00 UTC == 2026-05-19 00:00 EC.
    const out = nowInEcuador(new Date(Date.UTC(2026, 4, 19, 5, 0, 0)));
    expect(out.iso).toBe("2026-05-19");
  });

  it("renders one minute before EC midnight as the prior day", () => {
    // 2026-05-19 04:59 UTC == 2026-05-18 23:59 EC.
    const out = nowInEcuador(new Date(Date.UTC(2026, 4, 19, 4, 59, 0)));
    expect(out.iso).toBe("2026-05-18");
  });

  it("offset is stable year-round (Ecuador has no DST)", () => {
    // Summer (June) and winter (December) both UTC-5.
    const summer = nowInEcuador(new Date(Date.UTC(2026, 5, 15, 12, 0, 0)));
    const winter = nowInEcuador(new Date(Date.UTC(2026, 11, 15, 12, 0, 0)));
    expect(summer.iso).toBe("2026-06-15");
    expect(winter.iso).toBe("2026-12-15");
  });

  it("zero-pads month and day", () => {
    const out = nowInEcuador(new Date(Date.UTC(2026, 0, 3, 18, 0, 0)));
    expect(out.iso).toBe("2026-01-03");
    expect(out.year).toBe(2026);
    expect(out.month).toBe(1);
    expect(out.day).toBe(3);
  });

  it("works without the optional argument (uses Date.now())", () => {
    // Smoke check only: shape must be correct, values must be plausible.
    const out = nowInEcuador();
    expect(out.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.year).toBeGreaterThanOrEqual(2024);
    expect(out.month).toBeGreaterThanOrEqual(1);
    expect(out.month).toBeLessThanOrEqual(12);
    expect(out.day).toBeGreaterThanOrEqual(1);
    expect(out.day).toBeLessThanOrEqual(31);
  });

  it("returns the iso string consistently with the discrete fields", () => {
    const out = nowInEcuador(new Date(Date.UTC(2024, 3, 1, 12, 0, 0)));
    expect(out.iso).toBe(
      `${out.year.toString().padStart(4, "0")}-${out.month
        .toString()
        .padStart(2, "0")}-${out.day.toString().padStart(2, "0")}`,
    );
  });
});
