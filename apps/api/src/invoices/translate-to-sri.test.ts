/**
 * Unit tests for `translateInvoiceToSriRequest` (REVIEW-0044 CB-1 branch
 * coverage pass).
 *
 * The function is exercised end-to-end by the orchestrator integration
 * tests, but those only hit the "happy path" shape — every optional
 * conditional (`nombreComercial`, `contribuyenteEspecial`,
 * `direccionComprador`, `propina`, line `codigoPrincipal/codigoAuxiliar/
 * unidadMedida`, payment `plazo/unidadTiempo`, `infoAdicional`) remained
 * uncovered. We test the function directly with two minimal fixtures:
 *
 *   - "all-populated": every optional column is set so the truthy branch
 *     of every conditional fires.
 *   - "all-null":       every optional column is `null`/`0`/empty so the
 *     falsy branch fires.
 *
 * We also exercise the early-exit guard on missing `secuencial` /
 * `claveAcceso`.
 *
 * The function takes Prisma row shapes; we cast minimal fixture objects
 * because Prisma's generated types are wide and we only need a structural
 * match for the fields the function reads.
 */
import { describe, expect, it } from "vitest";

import {
  Prisma,
  type InvoiceLine,
  type InvoicePayment,
  type InvoiceAdicional,
} from "@facturador/db";

import { translateInvoiceToSriRequest } from "./translate-to-sri.js";

/* -------------------------------------------------------------------------- */
/* Helpers — minimal fixture rows                                             */
/* -------------------------------------------------------------------------- */

function makeLine(
  overrides: Partial<InvoiceLine> & { orden: number; descripcion: string },
): InvoiceLine {
  // Spread `overrides` last so caller fields win; `orden` and `descripcion`
  // come from `overrides`, so we don't repeat them explicitly above.
  return {
    id: "01HKTESTLINEID00000000000",
    invoiceId: "01HKTESTINVID000000000000",
    codigoPrincipal: null,
    codigoAuxiliar: null,
    unidadMedida: null,
    cantidad: new Prisma.Decimal(1) as unknown as InvoiceLine["cantidad"],
    precioUnitario: new Prisma.Decimal(100) as unknown as InvoiceLine["precioUnitario"],
    descuento: new Prisma.Decimal(0) as unknown as InvoiceLine["descuento"],
    precioTotalSinImpuesto: new Prisma.Decimal(
      100,
    ) as unknown as InvoiceLine["precioTotalSinImpuesto"],
    impuestosJson: [
      { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
    ] as unknown as InvoiceLine["impuestosJson"],
    ...overrides,
  } as InvoiceLine;
}

function makePayment(
  overrides: Partial<InvoicePayment> & { orden: number; formaPago: string },
): InvoicePayment {
  // Spread `overrides` last (same pattern as makeLine).
  return {
    id: "01HKTESTPAYID000000000000",
    invoiceId: "01HKTESTINVID000000000000",
    total: new Prisma.Decimal(115) as unknown as InvoicePayment["total"],
    plazo: null,
    unidadTiempo: null,
    ...overrides,
  } as InvoicePayment;
}

function makeAdicional(orden: number, nombre: string, valor: string): InvoiceAdicional {
  return {
    id: "01HKTESTADIID000000000000",
    invoiceId: "01HKTESTINVID000000000000",
    orden,
    nombre,
    valor,
  } as InvoiceAdicional;
}

function baseInput(): Parameters<typeof translateInvoiceToSriRequest>[0] {
  return {
    company: {
      id: "01HKTESTCOMPID0000000000",
      ruc: "1790012345001",
      razonSocial: "Synthetic Co",
      nombreComercial: null,
      direccionMatriz: "Quito, Ecuador",
      obligadoContabilidad: false,
      contribuyenteEspecial: null,
    },
    invoice: {
      id: "01HKTESTINVID000000000000",
      companyId: "01HKTESTCOMPID0000000000",
      estab: "001",
      ptoEmi: "001",
      secuencial: "000000001",
      claveAcceso: "1".repeat(49),
      fechaEmision: new Date("2026-05-20T00:00:00Z"),
      fechaEmisionLocal: "20/05/2026",
      ambiente: "1",
      tipoEmision: "1",
      obligadoContabilidad: false,
      contribuyenteEspecial: null,
      totalSinImpuestos: new Prisma.Decimal(100) as unknown as Prisma.Decimal,
      totalDescuento: new Prisma.Decimal(0) as unknown as Prisma.Decimal,
      propina: new Prisma.Decimal(0) as unknown as Prisma.Decimal,
      importeTotal: new Prisma.Decimal(115) as unknown as Prisma.Decimal,
      totalsJson: [
        {
          codigo: "2",
          codigoPorcentaje: "4",
          tarifa: 15,
          baseImponible: 100,
          valor: 15,
        },
      ] as unknown as Prisma.JsonValue,
    },
    customer: {
      tipoIdentificacion: "06",
      identificacion: "X12345678",
      razonSocial: "Customer SA",
      direccion: null,
    },
    emissionPoint: {
      id: "01HKTESTEPID00000000000",
      companyId: "01HKTESTCOMPID0000000000",
      establecimientoId: "01HKTESTESTID00000000000",
      codigo: "001",
      descripcion: "Caja Principal",
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      establecimiento: { codigo: "001", direccion: "Av. Amazonas N20-20" },
    } as unknown as Parameters<typeof translateInvoiceToSriRequest>[0]["emissionPoint"],
    lines: [makeLine({ orden: 0, descripcion: "Servicio Alpha" })],
    payments: [makePayment({ orden: 0, formaPago: "01" })],
    adicionales: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("translateInvoiceToSriRequest — branch coverage", () => {
  it("throws when secuencial is missing", () => {
    const input = baseInput();
    (input.invoice as { secuencial: string | null }).secuencial = null;
    expect(() => translateInvoiceToSriRequest(input)).toThrow(/requires secuencial \+ claveAcceso/);
  });

  it("throws when claveAcceso is missing", () => {
    const input = baseInput();
    (input.invoice as { claveAcceso: string | null }).claveAcceso = null;
    expect(() => translateInvoiceToSriRequest(input)).toThrow(/requires secuencial \+ claveAcceso/);
  });

  it("omits every optional field when columns are null (all-null path)", () => {
    const out = translateInvoiceToSriRequest(baseInput());
    const factura = out.factura as Record<string, unknown> & {
      infoTributaria: Record<string, unknown>;
      infoFactura: Record<string, unknown> & {
        pagos: Record<string, unknown>[];
      };
      detalles: Record<string, unknown>[];
    };
    expect("nombreComercial" in factura.infoTributaria).toBe(false);
    expect("contribuyenteEspecial" in factura.infoFactura).toBe(false);
    expect("direccionComprador" in factura.infoFactura).toBe(false);
    expect("propina" in factura.infoFactura).toBe(false);
    expect("infoAdicional" in factura).toBe(false);
    const firstLine = factura.detalles[0]!;
    expect("codigoPrincipal" in firstLine).toBe(false);
    expect("codigoAuxiliar" in firstLine).toBe(false);
    expect("unidadMedida" in firstLine).toBe(false);
    const firstPago = factura.infoFactura.pagos[0]!;
    expect("plazo" in firstPago).toBe(false);
    expect("unidadTiempo" in firstPago).toBe(false);
    expect(
      (factura.infoFactura as unknown as { obligadoContabilidad: string }).obligadoContabilidad,
    ).toBe("NO");
  });

  it("emits every optional field when columns are populated (all-populated path)", () => {
    const input = baseInput();
    (input.company as { nombreComercial: string | null }).nombreComercial = "Synthetic Trade Name";
    (input.company as { obligadoContabilidad: boolean }).obligadoContabilidad = true;
    (input.company as { contribuyenteEspecial: string | null }).contribuyenteEspecial = "12345";
    (input.customer as { direccion: string | null }).direccion = "Av. de los Shyris N32-100";
    (input.invoice as { propina: Prisma.Decimal }).propina = new Prisma.Decimal(2.5);
    // `Parameters<…>[0]` exposes lines/payments/adicionales as readonly.
    // Cast through a mutable view to override the seeds for this scenario.
    const mutable = input as unknown as {
      lines: InvoiceLine[];
      payments: InvoicePayment[];
      adicionales: InvoiceAdicional[];
    };
    mutable.lines = [
      makeLine({
        orden: 0,
        descripcion: "Servicio Beta",
        codigoPrincipal: "SKU-1",
        codigoAuxiliar: "AUX-1",
        unidadMedida: "UND",
      }),
    ];
    mutable.payments = [
      makePayment({
        orden: 0,
        formaPago: "01",
        plazo: new Prisma.Decimal(30) as unknown as InvoicePayment["plazo"],
        unidadTiempo: "dias",
      }),
    ];
    mutable.adicionales = [makeAdicional(0, "OC", "12345"), makeAdicional(1, "OBS", "Nota")];

    const out = translateInvoiceToSriRequest(input);
    const factura = out.factura as Record<string, unknown> & {
      infoTributaria: Record<string, unknown>;
      infoFactura: Record<string, unknown> & {
        pagos: Record<string, unknown>[];
        propina?: number;
      };
      detalles: Record<string, unknown>[];
      infoAdicional?: { nombre: string; valor: string }[];
    };
    expect(factura.infoTributaria.nombreComercial).toBe("Synthetic Trade Name");
    expect(factura.infoFactura.contribuyenteEspecial).toBe("12345");
    expect(factura.infoFactura.direccionComprador).toBe("Av. de los Shyris N32-100");
    expect(factura.infoFactura.obligadoContabilidad).toBe("SI");
    expect(factura.infoFactura.propina).toBeCloseTo(2.5, 2);
    expect(factura.detalles[0]?.codigoPrincipal).toBe("SKU-1");
    expect(factura.detalles[0]?.codigoAuxiliar).toBe("AUX-1");
    expect(factura.detalles[0]?.unidadMedida).toBe("UND");
    expect(factura.infoFactura.pagos[0]?.plazo).toBeCloseTo(30, 2);
    expect(factura.infoFactura.pagos[0]?.unidadTiempo).toBe("dias");
    expect(factura.infoAdicional).toHaveLength(2);
    expect(factura.infoAdicional?.[0]).toEqual({ nombre: "OC", valor: "12345" });
  });

  it("tolerates totalsJson being null (empty array fallback)", () => {
    const input = baseInput();
    (input.invoice as { totalsJson: Prisma.JsonValue | null }).totalsJson = null;
    const out = translateInvoiceToSriRequest(input);
    expect(
      (out.factura as { infoFactura: { totalConImpuestos: unknown[] } }).infoFactura
        .totalConImpuestos,
    ).toEqual([]);
  });

  it("decNum: handles number, string, and Decimal alike", () => {
    const input = baseInput();
    // Plant a string-typed Decimal through unknown — confirms decNum's string branch.
    (input.invoice as { totalSinImpuestos: unknown }).totalSinImpuestos = "150.5";
    const out = translateInvoiceToSriRequest(input);
    expect(
      (out.factura as { infoFactura: { totalSinImpuestos: number } }).infoFactura.totalSinImpuestos,
    ).toBeCloseTo(150.5, 2);

    const input2 = baseInput();
    (input2.invoice as { totalDescuento: unknown }).totalDescuento = 7.25;
    const out2 = translateInvoiceToSriRequest(input2);
    expect(
      (out2.factura as { infoFactura: { totalDescuento: number } }).infoFactura.totalDescuento,
    ).toBeCloseTo(7.25, 2);
  });
});
