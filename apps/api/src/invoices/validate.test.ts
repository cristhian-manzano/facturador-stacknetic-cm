/**
 * Tests for `validate.ts` — invoice payload validation.
 *
 * Surface under test (per SPEC-0032 §FR-3/§FR-5/§FR-6):
 *   - `parseFechaEmision` accepts well-formed `YYYY-MM-DD` and rejects
 *     malformed / impossible dates.
 *   - `formatFechaEmisionLocal` round-trips a parsed Date to `dd/mm/aaaa`.
 *   - `validateCreatePayload`:
 *       happy path → returns parsed body + Date;
 *       future-dated → BusinessError `invoice.fecha_invalida`;
 *       missing required field → ValidationError (Zod 400);
 *       IVA window mismatch (12% with 2026 fecha) → `invoice.tarifa_iva_invalida`.
 *   - `validateUpdatePayload`:
 *       partial PATCH (only `propina`) → ok;
 *       fechaEmision without lines → does NOT trip the window check;
 *       fechaEmision + lines with bad IVA → BusinessError.
 *
 * Synthetic-only fixtures — uses ULIDs from a stable test alphabet, no PII.
 */
import { describe, expect, it } from "vitest";

import { BusinessError, ValidationError } from "@facturador/utils/errors";

import {
  formatFechaEmisionLocal,
  parseFechaEmision,
  validateCreatePayload,
  validateUpdatePayload,
} from "./validate.js";

// Stable synthetic ULIDs — Crockford base32, 26 chars (no I/L/O/U). These
// are NOT real identifiers — they exist only as well-formed test fixtures.
const EP_ID = "01KS6PT809AR5XPR6H4ETPKX3Z";
const CUSTOMER_ID = "01KS6PT80ATT3GYPYBR1JWXEV5";

/**
 * A complete, valid CreateInvoice body (post-Zod-validation shape). We use
 * 2026-05-19 to land in the IVA-15% window; lines use codigoPorcentaje "4".
 */
function validCreateBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    emissionPointId: EP_ID,
    customerId: CUSTOMER_ID,
    fechaEmision: "2026-05-19",
    lines: [
      {
        descripcion: "Producto test",
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
      },
    ],
    payments: [{ formaPago: "01", total: 115 }],
    ...overrides,
  };
}

/** Stable injected `now` — 2026-05-19 (UTC). */
const NOW = new Date(Date.UTC(2026, 4, 19));

describe("parseFechaEmision", () => {
  it("accepts a well-formed YYYY-MM-DD string", () => {
    const d = parseFechaEmision("2024-04-01");
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(3); // April = 3 (0-indexed)
    expect(d.getUTCDate()).toBe(1);
  });

  it("rejects a malformed shape (slash separators)", () => {
    expect(() => parseFechaEmision("19/05/2026")).toThrow(ValidationError);
  });

  it("rejects an impossible calendar date (Feb 30)", () => {
    expect(() => parseFechaEmision("2024-02-30")).toThrow(ValidationError);
  });

  it("rejects a 13th month", () => {
    expect(() => parseFechaEmision("2024-13-01")).toThrow(ValidationError);
  });

  it("rejects empty / whitespace", () => {
    expect(() => parseFechaEmision("")).toThrow(ValidationError);
    expect(() => parseFechaEmision("   ")).toThrow(ValidationError);
  });
});

describe("formatFechaEmisionLocal", () => {
  it("formats a UTC-midnight Date as dd/mm/aaaa", () => {
    const d = parseFechaEmision("2026-05-19");
    expect(formatFechaEmisionLocal(d)).toBe("19/05/2026");
  });

  it("zero-pads day and month", () => {
    const d = parseFechaEmision("2024-04-01");
    expect(formatFechaEmisionLocal(d)).toBe("01/04/2024");
  });

  it("round-trips parse → format losslessly", () => {
    const s = "2025-12-31";
    expect(formatFechaEmisionLocal(parseFechaEmision(s))).toBe("31/12/2025");
  });
});

describe("validateCreatePayload — happy path", () => {
  it("returns the parsed body and a Date for fechaEmision", () => {
    const { parsed, fechaEmision } = validateCreatePayload(validCreateBody(), {
      now: NOW,
    });
    expect(parsed.fechaEmision).toBe("2026-05-19");
    expect(fechaEmision.getUTCFullYear()).toBe(2026);
  });

  it("accepts inline customer (no customerId)", () => {
    const body = validCreateBody({
      customerId: undefined,
      customer: {
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
        razonSocial: "CONSUMIDOR FINAL",
      },
    });
    const { parsed } = validateCreatePayload(body, { now: NOW });
    expect(parsed.customer).toBeDefined();
  });
});

describe("validateCreatePayload — future-dated fechaEmision", () => {
  it("rejects fechaEmision > now + 1 day with invoice.fecha_invalida", () => {
    // now = 2026-05-19; fechaEmision = 2026-05-21 is +2 days → reject.
    let captured: unknown;
    try {
      validateCreatePayload(validCreateBody({ fechaEmision: "2026-05-21" }), {
        now: NOW,
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(BusinessError);
    expect((captured as BusinessError).code).toBe("invoice.fecha_invalida");
  });

  it("accepts fechaEmision = now + 1 day (boundary tolerance per AC-2)", () => {
    // now = 2026-05-19; fechaEmision = 2026-05-20 is +1 day → ok.
    expect(() =>
      validateCreatePayload(validCreateBody({ fechaEmision: "2026-05-20" }), {
        now: NOW,
      }),
    ).not.toThrow();
  });
});

describe("validateCreatePayload — IVA window mismatch", () => {
  it("rejects codigoPorcentaje 2 (12%) with fechaEmision in 2026 (post-decreto)", () => {
    const body = validCreateBody({
      lines: [
        {
          descripcion: "Producto pre-decreto",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          impuestos: [{ codigo: "2", codigoPorcentaje: "2", tarifa: 12 }],
        },
      ],
    });
    let captured: unknown;
    try {
      validateCreatePayload(body, { now: NOW });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(BusinessError);
    expect((captured as BusinessError).code).toBe("invoice.tarifa_iva_invalida");
  });

  it("rejects codigoPorcentaje 4 (15%) with fechaEmision pre-decreto (2024-03-31)", () => {
    // Use a `now` that allows 2024-03-31 (i.e. far in the past relative to NOW=2026).
    const body = validCreateBody({
      fechaEmision: "2024-03-31",
      lines: [
        {
          descripcion: "Producto 2024-03",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          // Trying to use 15% before it took effect.
          impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
        },
      ],
    });
    let captured: unknown;
    try {
      validateCreatePayload(body, { now: NOW });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(BusinessError);
    expect((captured as BusinessError).code).toBe("invoice.tarifa_iva_invalida");
  });

  it("accepts IVA-0 (codigoPorcentaje 0) for any date", () => {
    const body = validCreateBody({
      lines: [
        {
          descripcion: "Producto exento",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          impuestos: [{ codigo: "2", codigoPorcentaje: "0", tarifa: 0 }],
        },
      ],
    });
    expect(() => validateCreatePayload(body, { now: NOW })).not.toThrow();
  });
});

describe("validateCreatePayload — missing required fields (Zod)", () => {
  it("rejects when lines is missing", () => {
    const body = validCreateBody();
    delete (body as Record<string, unknown>).lines;
    expect(() => validateCreatePayload(body, { now: NOW })).toThrow();
  });

  it("rejects when payments is missing", () => {
    const body = validCreateBody();
    delete (body as Record<string, unknown>).payments;
    expect(() => validateCreatePayload(body, { now: NOW })).toThrow();
  });

  it("rejects when neither customerId nor customer is provided", () => {
    const body = validCreateBody({ customerId: undefined });
    expect(() => validateCreatePayload(body, { now: NOW })).toThrow();
  });

  it("rejects malformed fechaEmision (not YYYY-MM-DD)", () => {
    const body = validCreateBody({ fechaEmision: "19/05/2026" });
    expect(() => validateCreatePayload(body, { now: NOW })).toThrow();
  });

  it("rejects an emissionPointId that isn't a valid ULID", () => {
    const body = validCreateBody({ emissionPointId: "not-a-ulid" });
    expect(() => validateCreatePayload(body, { now: NOW })).toThrow();
  });
});

describe("validateUpdatePayload", () => {
  it("accepts a partial payload (propina only)", () => {
    const { parsed, fechaEmision } = validateUpdatePayload({ propina: 5 }, { now: NOW });
    expect(parsed.propina).toBe(5);
    expect(fechaEmision).toBeNull();
  });

  it("rejects an empty payload (refine: at least one field)", () => {
    expect(() => validateUpdatePayload({}, { now: NOW })).toThrow();
  });

  it("rejects fechaEmision > now + 1 day with invoice.fecha_invalida", () => {
    let captured: unknown;
    try {
      validateUpdatePayload({ fechaEmision: "2026-05-22" }, { now: NOW });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(BusinessError);
    expect((captured as BusinessError).code).toBe("invoice.fecha_invalida");
  });

  it("skips IVA window check when fechaEmision is absent but lines are present", () => {
    // Trust the persisted fechaEmision; PATCH that only edits lines does
    // not re-check tarifas (the handler does, via the existing row).
    const body = {
      lines: [
        {
          descripcion: "test",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          impuestos: [{ codigo: "2", codigoPorcentaje: "2", tarifa: 12 }],
        },
      ],
    };
    expect(() => validateUpdatePayload(body, { now: NOW })).not.toThrow();
  });

  it("enforces IVA window when both fechaEmision and lines are provided", () => {
    const body = {
      fechaEmision: "2026-05-19",
      lines: [
        {
          descripcion: "test",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          // 12% is invalid in 2026 → reject.
          impuestos: [{ codigo: "2", codigoPorcentaje: "2", tarifa: 12 }],
        },
      ],
    };
    let captured: unknown;
    try {
      validateUpdatePayload(body, { now: NOW });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(BusinessError);
    expect((captured as BusinessError).code).toBe("invoice.tarifa_iva_invalida");
  });

  it("returns the parsed Date when fechaEmision is provided", () => {
    const { fechaEmision } = validateUpdatePayload({ fechaEmision: "2026-05-19" }, { now: NOW });
    expect(fechaEmision).not.toBeNull();
    expect(fechaEmision?.getUTCFullYear()).toBe(2026);
  });

  it("ignores codigo 3 (ICE) and 5 (IRBPNR) in IVA validation", () => {
    // We only validate IVA (codigo "2") windows; other tax types pass.
    const body = {
      fechaEmision: "2026-05-19",
      lines: [
        {
          descripcion: "test",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          impuestos: [{ codigo: "3", codigoPorcentaje: "3011", tarifa: 75 }],
        },
      ],
    };
    expect(() => validateUpdatePayload(body, { now: NOW })).not.toThrow();
  });
});
