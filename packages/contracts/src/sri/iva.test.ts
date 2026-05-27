/**
 * Tests for `@facturador/contracts/sri/iva`.
 *
 * Mirrors and consolidates the legacy parity tests from both apps
 * (`apps/api/src/invoices/tax-rates.test.ts`, `apps/web/src/invoices/
 * tax-rates.test.ts`) so any drift is caught here before the apps even
 * import.
 */
import { describe, expect, it } from "vitest";

import {
  IVA_15_EFFECTIVE_FROM,
  IVA_CODIGO,
  IVA_TABLE,
  getIvaRow,
  isIvaCodeValidFor,
  pickIvaCode,
} from "./iva.js";

/** Local helper that mirrors `parseFechaEmision` in `apps/api`. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("pickIvaCode — Date input (api call shape)", () => {
  it("returns 12% for 2024-03-31", () => {
    const r = pickIvaCode(utcDay(2024, 3, 31));
    expect(r).toEqual({ codigo: IVA_CODIGO, codigoPorcentaje: "2", tarifa: 12 });
  });

  it("returns 15% on the 2024-04-01 boundary", () => {
    const r = pickIvaCode(utcDay(2024, 4, 1));
    expect(r).toEqual({ codigo: IVA_CODIGO, codigoPorcentaje: "4", tarifa: 15 });
  });

  it("returns 15% in the current era", () => {
    expect(pickIvaCode(utcDay(2026, 5, 19))).toEqual({
      codigo: IVA_CODIGO,
      codigoPorcentaje: "4",
      tarifa: 15,
    });
  });

  it("returns 12% for a pre-boundary date (2017)", () => {
    expect(pickIvaCode(utcDay(2017, 6, 1))).toEqual({
      codigo: IVA_CODIGO,
      codigoPorcentaje: "2",
      tarifa: 12,
    });
  });

  it("is deterministic for the same instant", () => {
    expect(pickIvaCode(utcDay(2024, 4, 1))).toEqual(pickIvaCode(utcDay(2024, 4, 1)));
  });
});

describe("pickIvaCode — string input (web call shape)", () => {
  it("returns 12% for dates before 2024-04-01", () => {
    expect(pickIvaCode("2023-12-31")).toEqual({
      codigo: "2",
      codigoPorcentaje: "2",
      tarifa: 12,
    });
    expect(pickIvaCode("2024-03-31")).toEqual({
      codigo: "2",
      codigoPorcentaje: "2",
      tarifa: 12,
    });
  });

  it("returns 15% on the boundary (2024-04-01) using the exported constant", () => {
    expect(pickIvaCode(IVA_15_EFFECTIVE_FROM)).toEqual({
      codigo: "2",
      codigoPorcentaje: "4",
      tarifa: 15,
    });
  });

  it("returns 15% for dates after the boundary", () => {
    expect(pickIvaCode("2026-01-01")).toEqual({
      codigo: "2",
      codigoPorcentaje: "4",
      tarifa: 15,
    });
  });
});

describe("IVA_15_EFFECTIVE_FROM constant", () => {
  it("is pinned to 2024-04-01", () => {
    expect(IVA_15_EFFECTIVE_FROM).toBe("2024-04-01");
  });
});

describe("IVA_TABLE — catalog rows", () => {
  it("places 15% (codigoPorcentaje 4) first for the web dropdown default", () => {
    expect(IVA_TABLE[0]?.codigoPorcentaje).toBe("4");
  });

  it("contains codigoPorcentaje 0 mapped to tarifa 0 (always valid)", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "0");
    expect(row).toBeDefined();
    expect(row?.tarifa).toBe(0);
    expect(row?.validFrom).toBeNull();
    expect(row?.validTo).toBeNull();
  });

  it("contains codigoPorcentaje 2 mapped to tarifa 12 with validTo 2024-03-31", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "2");
    expect(row?.tarifa).toBe(12);
    expect(row?.validFrom).toBeNull();
    expect(row?.validTo).toBe("2024-03-31");
  });

  it("contains codigoPorcentaje 3 mapped to tarifa 14 (2017 window)", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "3");
    expect(row?.tarifa).toBe(14);
    expect(row?.validFrom).toBe("2017-06-01");
    expect(row?.validTo).toBe("2017-12-31");
  });

  it("contains codigoPorcentaje 4 mapped to tarifa 15 with validFrom 2024-04-01", () => {
    const row = IVA_TABLE.find((r) => r.codigoPorcentaje === "4");
    expect(row?.tarifa).toBe(15);
    expect(row?.validFrom).toBe("2024-04-01");
    expect(row?.validTo).toBeNull();
  });

  it("contains codigoPorcentaje 5 (5% construcción), 6 (no objeto), 7 (exento), 8 (diferenciado)", () => {
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "5")?.tarifa).toBe(5);
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "6")?.tarifa).toBe(0);
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "7")?.tarifa).toBe(0);
    expect(IVA_TABLE.find((r) => r.codigoPorcentaje === "8")?.tarifa).toBeNull();
  });

  it("every row carries codigo IVA_CODIGO ('2')", () => {
    for (const row of IVA_TABLE) {
      expect(row.codigo).toBe(IVA_CODIGO);
    }
  });

  it("every row exposes a non-empty Spanish label", () => {
    for (const row of IVA_TABLE) {
      expect(row.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isIvaCodeValidFor — window enforcement", () => {
  it("accepts 12% for 2024-03-31, rejects from 2024-04-01", () => {
    expect(isIvaCodeValidFor("2", utcDay(2024, 3, 31))).toBe(true);
    expect(isIvaCodeValidFor("2", utcDay(2024, 4, 1))).toBe(false);
  });

  it("accepts 15% from 2024-04-01, rejects before", () => {
    expect(isIvaCodeValidFor("4", utcDay(2024, 4, 1))).toBe(true);
    expect(isIvaCodeValidFor("4", utcDay(2024, 3, 31))).toBe(false);
  });

  it("accepts 14% only in 2017", () => {
    expect(isIvaCodeValidFor("3", utcDay(2017, 6, 1))).toBe(true);
    expect(isIvaCodeValidFor("3", utcDay(2017, 12, 31))).toBe(true);
    expect(isIvaCodeValidFor("3", utcDay(2017, 5, 31))).toBe(false);
    expect(isIvaCodeValidFor("3", utcDay(2018, 1, 1))).toBe(false);
  });

  it("accepts open-window codes (0, 5, 6, 7, 8) for any date", () => {
    const d = utcDay(2026, 5, 19);
    for (const cp of ["0", "5", "6", "7", "8"]) {
      expect(isIvaCodeValidFor(cp, d)).toBe(true);
    }
  });

  it("returns false for unknown codes", () => {
    expect(isIvaCodeValidFor("99", utcDay(2026, 5, 19))).toBe(false);
    expect(isIvaCodeValidFor("", utcDay(2026, 5, 19))).toBe(false);
  });

  it("works with string fechaEmision input too", () => {
    expect(isIvaCodeValidFor("4", "2026-05-19")).toBe(true);
    expect(isIvaCodeValidFor("2", "2026-05-19")).toBe(false);
  });
});

describe("getIvaRow", () => {
  it("returns the matching row by codigoPorcentaje", () => {
    expect(getIvaRow("4")?.label).toBe("15%");
    expect(getIvaRow("2")?.label).toBe("12% (histórico)");
  });

  it("returns undefined for an unknown code", () => {
    expect(getIvaRow("99")).toBeUndefined();
  });
});
