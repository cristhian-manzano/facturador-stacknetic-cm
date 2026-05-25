/**
 * Tests for `tax-rates.ts` — `pickIvaCode(fecha)` + `IVA_TABLE`.
 *
 * Surface under test (per SPEC-0032 §FR-6 + PROMPT-0032 hard rule):
 *   - `pickIvaCode` switches at the **2024-04-01 boundary** (Decreto 198):
 *     2024-03-31 and earlier → 12% (codigoPorcentaje "2");
 *     2024-04-01 and later  → 15% (codigoPorcentaje "4").
 *   - `isIvaCodeValidFor` enforces validity windows for every catalog row.
 *   - `IVA_TABLE` exposes the documented codes for 0/5/6/7/8 and the 14%
 *     historic 2017 window.
 *   - `getIvaRow` returns the same identity as the table entry.
 *   - The selector is PURE: no global state, deterministic across runs.
 *
 * Dates are constructed via `Date.UTC(y, m-1, d)` to avoid TZ skew —
 * mirroring the production callers (`parseFechaEmision` in `validate.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  IVA_15_EFFECTIVE_FROM,
  IVA_CODIGO,
  IVA_TABLE,
  getIvaRow,
  isIvaCodeValidFor,
  pickIvaCode,
} from "./tax-rates.js";

/**
 * Local-midnight UTC Date factory — matches the shape `parseFechaEmision`
 * produces. Keeping the helper in the test keeps the dependency explicit.
 */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("pickIvaCode — 2024-04-01 boundary", () => {
  it("returns 12% (codigoPorcentaje 2) for 2024-03-31", () => {
    const r = pickIvaCode(utcDay(2024, 3, 31));
    expect(r.codigo).toBe(IVA_CODIGO);
    expect(r.codigoPorcentaje).toBe("2");
    expect(r.tarifa).toBe(12);
  });

  it("returns 15% (codigoPorcentaje 4) on 2024-04-01 exactly", () => {
    const r = pickIvaCode(utcDay(2024, 4, 1));
    expect(r.codigo).toBe(IVA_CODIGO);
    expect(r.codigoPorcentaje).toBe("4");
    expect(r.tarifa).toBe(15);
  });

  it("returns 15% for 2024-04-02 (day after the boundary)", () => {
    const r = pickIvaCode(utcDay(2024, 4, 2));
    expect(r.codigoPorcentaje).toBe("4");
    expect(r.tarifa).toBe(15);
  });

  it("returns 15% for 2026-05-19 (current era)", () => {
    const r = pickIvaCode(utcDay(2026, 5, 19));
    expect(r.codigoPorcentaje).toBe("4");
    expect(r.tarifa).toBe(15);
  });

  it("returns 12% for 2023-12-31 (year before)", () => {
    const r = pickIvaCode(utcDay(2023, 12, 31));
    expect(r.codigoPorcentaje).toBe("2");
    expect(r.tarifa).toBe(12);
  });

  it("returns 12% for 2017-06-01 (pre-IVA-15)", () => {
    const r = pickIvaCode(utcDay(2017, 6, 1));
    expect(r.codigoPorcentaje).toBe("2");
    expect(r.tarifa).toBe(12);
  });

  it("is deterministic — same date always returns the same row", () => {
    const a = pickIvaCode(utcDay(2024, 4, 1));
    const b = pickIvaCode(utcDay(2024, 4, 1));
    expect(a).toEqual(b);
  });

  it("exposes the boundary constant", () => {
    expect(IVA_15_EFFECTIVE_FROM).toBe("2024-04-01");
  });
});

describe("IVA_TABLE — catalog rows", () => {
  it("contains codigoPorcentaje 0 mapped to tarifa 0 (always valid)", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "0");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBe(0);
    expect(row?.validFrom).toBeNull();
    expect(row?.validTo).toBeNull();
  });

  it("contains codigoPorcentaje 2 mapped to tarifa 12 with validTo 2024-03-31", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "2");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBe(12);
    expect(row?.validFrom).toBeNull();
    expect(row?.validTo).toBe("2024-03-31");
  });

  it("contains codigoPorcentaje 3 mapped to tarifa 14 (2017 window)", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "3");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBe(14);
    expect(row?.validFrom).toBe("2017-06-01");
    expect(row?.validTo).toBe("2017-12-31");
  });

  it("contains codigoPorcentaje 4 mapped to tarifa 15 with validFrom 2024-04-01", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "4");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBe(15);
    expect(row?.validFrom).toBe("2024-04-01");
    expect(row?.validTo).toBeNull();
  });

  it("contains codigoPorcentaje 5 mapped to tarifa 5 (construcción)", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "5");
    expect(row?.tarifa).toBe(5);
  });

  it("contains codigoPorcentaje 6 (No objeto) and 7 (Exento) at tarifa 0", () => {
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "6")?.tarifa).toBe(0);
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "7")?.tarifa).toBe(0);
  });

  it("contains codigoPorcentaje 8 (Diferenciado) with null tarifa", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "8");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBeNull();
  });

  it("every row carries codigo IVA_CODIGO ('2')", () => {
    for (const row of IVA_TABLE) {
      expect(row.codigo).toBe(IVA_CODIGO);
    }
  });
});

describe("isIvaCodeValidFor — window enforcement", () => {
  it("accepts codigoPorcentaje 2 (12%) for 2024-03-31", () => {
    expect(isIvaCodeValidFor("2", utcDay(2024, 3, 31))).toBe(true);
  });

  it("rejects codigoPorcentaje 2 (12%) for 2024-04-01 onwards", () => {
    expect(isIvaCodeValidFor("2", utcDay(2024, 4, 1))).toBe(false);
    expect(isIvaCodeValidFor("2", utcDay(2025, 1, 1))).toBe(false);
  });

  it("accepts codigoPorcentaje 4 (15%) for 2024-04-01 onwards", () => {
    expect(isIvaCodeValidFor("4", utcDay(2024, 4, 1))).toBe(true);
    expect(isIvaCodeValidFor("4", utcDay(2026, 5, 19))).toBe(true);
  });

  it("rejects codigoPorcentaje 4 (15%) for 2024-03-31 and earlier", () => {
    expect(isIvaCodeValidFor("4", utcDay(2024, 3, 31))).toBe(false);
    expect(isIvaCodeValidFor("4", utcDay(2017, 1, 1))).toBe(false);
  });

  it("accepts codigoPorcentaje 3 (14% historic) only for 2017", () => {
    expect(isIvaCodeValidFor("3", utcDay(2017, 6, 1))).toBe(true);
    expect(isIvaCodeValidFor("3", utcDay(2017, 12, 31))).toBe(true);
    expect(isIvaCodeValidFor("3", utcDay(2017, 5, 31))).toBe(false);
    expect(isIvaCodeValidFor("3", utcDay(2018, 1, 1))).toBe(false);
  });

  it("accepts open-window codes (0, 5, 6, 7, 8) for any date", () => {
    const someDate = utcDay(2026, 5, 19);
    for (const cp of ["0", "5", "6", "7", "8"]) {
      expect(isIvaCodeValidFor(cp, someDate)).toBe(true);
    }
  });

  it("returns false for an unknown code", () => {
    expect(isIvaCodeValidFor("99", utcDay(2026, 5, 19))).toBe(false);
    expect(isIvaCodeValidFor("", utcDay(2026, 5, 19))).toBe(false);
  });
});

describe("getIvaRow — direct catalog lookup", () => {
  it("returns the row for a known code", () => {
    const row = getIvaRow("4");
    expect(row?.codigoPorcentaje).toBe("4");
    expect(row?.tarifa).toBe(15);
  });

  it("returns undefined for an unknown code", () => {
    expect(getIvaRow("zz")).toBeUndefined();
    expect(getIvaRow("999")).toBeUndefined();
  });
});
