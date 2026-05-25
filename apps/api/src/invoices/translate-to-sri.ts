/**
 * Translate a persisted Invoice + its dependent rows into the
 * `EmitDocumentRequest` body sent to apps/sri-core.
 *
 * Source of truth: SPEC-0033 §6.2.
 *
 * Why this lives apart from the handler:
 *   - Pure function — no DB, no clock; deterministic given inputs.
 *   - Easier to unit test as a fixture-driven snapshot.
 *
 * The `factura` field is the `FacturaXmlInput` shape consumed by sri-core's
 * XML builder. We assemble it field-by-field; the receiver re-validates via
 * Zod so any drift in our shape surfaces as a 400 there rather than a
 * silently-broken XML downstream.
 */
import { Prisma } from "@facturador/db";
import type {
  Company,
  Customer,
  EmissionPoint,
  Establecimiento,
  InvoiceAdicional,
  InvoiceLine,
  InvoicePayment,
  Invoice as InvoiceRow,
} from "@facturador/db";
import type { EmitDocumentRequest } from "@facturador/contracts/sri";

function decNum(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface TranslateInput {
  readonly company: Pick<
    Company,
    | "id"
    | "ruc"
    | "razonSocial"
    | "nombreComercial"
    | "direccionMatriz"
    | "obligadoContabilidad"
    | "contribuyenteEspecial"
  >;
  readonly invoice: Pick<
    InvoiceRow,
    | "id"
    | "companyId"
    | "estab"
    | "ptoEmi"
    | "secuencial"
    | "claveAcceso"
    | "fechaEmision"
    | "fechaEmisionLocal"
    | "ambiente"
    | "tipoEmision"
    | "obligadoContabilidad"
    | "contribuyenteEspecial"
    | "totalSinImpuestos"
    | "totalDescuento"
    | "propina"
    | "importeTotal"
    | "totalsJson"
  >;
  readonly customer: Pick<
    Customer,
    "tipoIdentificacion" | "identificacion" | "razonSocial" | "direccion"
  >;
  readonly emissionPoint: EmissionPoint & {
    establecimiento: Pick<Establecimiento, "codigo" | "direccion">;
  };
  readonly lines: readonly InvoiceLine[];
  readonly payments: readonly InvoicePayment[];
  readonly adicionales: readonly InvoiceAdicional[];
}

export function translateInvoiceToSriRequest(input: TranslateInput): EmitDocumentRequest {
  const { invoice, company, customer, emissionPoint, lines, payments, adicionales } = input;

  if (invoice.secuencial === null || invoice.claveAcceso === null) {
    throw new Error("translateInvoiceToSriRequest requires secuencial + claveAcceso to be set");
  }

  const totalConImpuestos = (invoice.totalsJson ?? []) as unknown as readonly {
    codigo: string;
    codigoPorcentaje: string;
    tarifa: number;
    baseImponible: number;
    valor: number;
  }[];

  return {
    companyId: company.id as EmitDocumentRequest["companyId"],
    ambiente: invoice.ambiente as EmitDocumentRequest["ambiente"],
    codDoc: "01",
    estab: invoice.estab as EmitDocumentRequest["estab"],
    ptoEmi: invoice.ptoEmi as EmitDocumentRequest["ptoEmi"],
    secuencial: invoice.secuencial as EmitDocumentRequest["secuencial"],
    claveAcceso: invoice.claveAcceso as EmitDocumentRequest["claveAcceso"],
    fechaEmision: invoice.fechaEmisionLocal as EmitDocumentRequest["fechaEmision"],
    tipoEmision: invoice.tipoEmision as EmitDocumentRequest["tipoEmision"],
    factura: {
      infoTributaria: {
        ambiente: invoice.ambiente,
        tipoEmision: invoice.tipoEmision,
        razonSocial: company.razonSocial,
        ...(company.nombreComercial === null ? {} : { nombreComercial: company.nombreComercial }),
        ruc: company.ruc,
        claveAcceso: invoice.claveAcceso,
        codDoc: "01",
        estab: invoice.estab,
        ptoEmi: invoice.ptoEmi,
        secuencial: invoice.secuencial,
        dirMatriz: company.direccionMatriz,
      },
      infoFactura: {
        fechaEmision: invoice.fechaEmisionLocal,
        dirEstablecimiento: emissionPoint.establecimiento.direccion,
        ...(company.contribuyenteEspecial === null
          ? {}
          : { contribuyenteEspecial: company.contribuyenteEspecial }),
        obligadoContabilidad: company.obligadoContabilidad ? "SI" : "NO",
        tipoIdentificacionComprador: customer.tipoIdentificacion,
        razonSocialComprador: customer.razonSocial,
        identificacionComprador: customer.identificacion,
        ...(customer.direccion === null ? {} : { direccionComprador: customer.direccion }),
        totalSinImpuestos: round2(decNum(invoice.totalSinImpuestos)),
        totalDescuento: round2(decNum(invoice.totalDescuento)),
        totalConImpuestos: totalConImpuestos.map((t) => ({
          codigo: t.codigo,
          codigoPorcentaje: t.codigoPorcentaje,
          baseImponible: round2(t.baseImponible),
          tarifa: t.tarifa,
          valor: round2(t.valor),
        })),
        ...(decNum(invoice.propina) === 0 ? {} : { propina: round2(decNum(invoice.propina)) }),
        importeTotal: round2(decNum(invoice.importeTotal)),
        moneda: "DOLAR",
        pagos: payments
          .slice()
          .sort((a, b) => a.orden - b.orden)
          .map((p) => ({
            formaPago: p.formaPago,
            total: round2(decNum(p.total)),
            ...(p.plazo === null ? {} : { plazo: round2(decNum(p.plazo)) }),
            ...(p.unidadTiempo === null ? {} : { unidadTiempo: p.unidadTiempo }),
          })),
      },
      detalles: lines
        .slice()
        .sort((a, b) => a.orden - b.orden)
        .map((l) => ({
          ...(l.codigoPrincipal === null ? {} : { codigoPrincipal: l.codigoPrincipal }),
          ...(l.codigoAuxiliar === null ? {} : { codigoAuxiliar: l.codigoAuxiliar }),
          descripcion: l.descripcion,
          ...(l.unidadMedida === null ? {} : { unidadMedida: l.unidadMedida }),
          cantidad: decNum(l.cantidad),
          precioUnitario: decNum(l.precioUnitario),
          descuento: round2(decNum(l.descuento)),
          precioTotalSinImpuesto: round2(decNum(l.precioTotalSinImpuesto)),
          impuestos: (
            l.impuestosJson as unknown as readonly {
              codigo: string;
              codigoPorcentaje: string;
              tarifa: number;
              baseImponible: number;
              valor: number;
            }[]
          ).map((i) => ({
            codigo: i.codigo,
            codigoPorcentaje: i.codigoPorcentaje,
            tarifa: i.tarifa,
            baseImponible: round2(i.baseImponible),
            valor: round2(i.valor),
          })),
        })),
      ...(adicionales.length === 0
        ? {}
        : {
            infoAdicional: adicionales
              .slice()
              .sort((a, b) => a.orden - b.orden)
              .map((a) => ({ nombre: a.nombre, valor: a.valor })),
          }),
    },
  };
}
