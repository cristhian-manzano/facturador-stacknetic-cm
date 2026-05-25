/**
 * `pickIvaCode` / `getIvaRow` tests — parity with the API helper.
 */
import { describe, expect, it } from "vitest";

import {
  FORMA_PAGO_TABLE,
  getIvaRow,
  IVA_15_EFFECTIVE_FROM,
  IVA_TABLE,
  pickIvaCode,
  TIPO_IDENTIFICACION_TABLE,
} from "./tax-rates.js";

describe("pickIvaCode", () => {
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
  it("returns 15% on the boundary (2024-04-01)", () => {
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

describe("getIvaRow", () => {
  it("returns the matching row", () => {
    expect(getIvaRow("4")?.label).toBe("15%");
    expect(getIvaRow("2")?.label).toBe("12% (histórico)");
  });
  it("returns undefined for unknown codes", () => {
    expect(getIvaRow("99")).toBeUndefined();
  });
});

describe("catalog tables", () => {
  it("IVA_TABLE includes 15% as the first option", () => {
    expect(IVA_TABLE[0]?.codigoPorcentaje).toBe("4");
  });
  it("FORMA_PAGO_TABLE has 8 entries matching SRI catalog", () => {
    expect(FORMA_PAGO_TABLE).toHaveLength(8);
    expect(FORMA_PAGO_TABLE.map((r) => r.codigo)).toEqual([
      "01",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
    ]);
  });
  it("TIPO_IDENTIFICACION_TABLE includes all 5 branches", () => {
    expect(TIPO_IDENTIFICACION_TABLE.map((r) => r.codigo).sort()).toEqual([
      "04",
      "05",
      "06",
      "07",
      "08",
    ]);
  });
});
