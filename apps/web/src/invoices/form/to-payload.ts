/**
 * `toCreateInvoicePayload` / `toUpdateInvoicePayload` — boundary helpers
 * that turn the string-typed form state into the schema-typed payload the
 * server expects (SPEC-0042 §7.3 hard rule: parse via parseMoney at the
 * boundary; never let raw strings reach the server).
 *
 * Branded types: `@facturador/contracts` uses Zod `.brand<>()` for ULIDs,
 * ISO dates, etc. The form holds raw strings; we cast them through the
 * schema's input type by parsing — but `CreateInvoiceSchema.parse(...)` will
 * coerce them at the API boundary anyway, so internally we just rely on the
 * runtime parse to attach the brand. To satisfy TS we use a small `assertAs`
 * helper that names the brand-loss as deliberate (the runtime guard is the
 * Zod schema at the apiFetch boundary).
 */
import type { CreateInvoice, UpdateInvoice } from "@facturador/contracts/invoices";

import { parseMoney } from "../money.js";
import { getIvaRow, IVA_CODIGO } from "../tax-rates.js";
import type { InvoiceFormValues } from "./types.js";

/**
 * Cast a string to a branded string. The runtime guard is the Zod schema
 * parse that happens later (either via `createInvoiceDraft`'s parse step
 * or the server-side validation). The form layer treats every primitive
 * field as a plain string.
 */
function brand<T>(value: string): T {
  return value as unknown as T;
}

/**
 * Result type. `ok:false` carries the reason so the form layer can surface
 * a useful error (RHF inline + summary).
 */
export type ToPayloadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly fieldPath?: string };

function buildLines(
  values: InvoiceFormValues,
): { ok: true; value: CreateInvoice["lines"] } | { ok: false; reason: string; fieldPath: string } {
  const out: CreateInvoice["lines"] = [];
  for (let i = 0; i < values.lines.length; i++) {
    const line = values.lines[i];
    if (line === undefined) continue;
    const cantidad = parseMoney(line.cantidad);
    if (!cantidad.ok) {
      return {
        ok: false,
        reason: "cantidad inválida",
        fieldPath: `lines.${i}.cantidad`,
      };
    }
    const precioUnitario = parseMoney(line.precioUnitario);
    if (!precioUnitario.ok) {
      return {
        ok: false,
        reason: "precio inválido",
        fieldPath: `lines.${i}.precioUnitario`,
      };
    }
    const descuento = parseMoney(line.descuento === "" ? "0" : line.descuento);
    if (!descuento.ok) {
      return {
        ok: false,
        reason: "descuento inválido",
        fieldPath: `lines.${i}.descuento`,
      };
    }
    const row = getIvaRow(line.codigoPorcentaje);
    if (row === undefined) {
      return {
        ok: false,
        reason: "código IVA inválido",
        fieldPath: `lines.${i}.codigoPorcentaje`,
      };
    }
    const tarifa = row.tarifa ?? 0;
    const lineOut: CreateInvoice["lines"][number] = {
      descripcion: line.descripcion,
      cantidad: cantidad.value,
      precioUnitario: precioUnitario.value,
      descuento: descuento.value,
      impuestos: [
        {
          codigo: IVA_CODIGO,
          codigoPorcentaje: row.codigoPorcentaje,
          tarifa,
        },
      ],
    };
    if (line.codigoPrincipal !== undefined && line.codigoPrincipal !== "")
      lineOut.codigoPrincipal = line.codigoPrincipal;
    if (line.codigoAuxiliar !== undefined && line.codigoAuxiliar !== "")
      lineOut.codigoAuxiliar = line.codigoAuxiliar;
    if (line.unidadMedida !== undefined && line.unidadMedida !== "")
      lineOut.unidadMedida = line.unidadMedida;
    out.push(lineOut);
  }
  return { ok: true, value: out };
}

function buildPayments(
  values: InvoiceFormValues,
):
  | { ok: true; value: CreateInvoice["payments"] }
  | { ok: false; reason: string; fieldPath: string } {
  const out: CreateInvoice["payments"] = [];
  for (let i = 0; i < values.payments.length; i++) {
    const pay = values.payments[i];
    if (pay === undefined) continue;
    const total = parseMoney(pay.total);
    if (!total.ok) {
      return {
        ok: false,
        reason: "total de pago inválido",
        fieldPath: `payments.${i}.total`,
      };
    }
    const payOut: CreateInvoice["payments"][number] = {
      formaPago: pay.formaPago,
      total: total.value,
    };
    if (pay.plazo !== undefined && pay.plazo !== "") {
      const plazo = parseMoney(pay.plazo);
      if (!plazo.ok) {
        return {
          ok: false,
          reason: "plazo inválido",
          fieldPath: `payments.${i}.plazo`,
        };
      }
      payOut.plazo = plazo.value;
    }
    if (pay.unidadTiempo !== undefined && pay.unidadTiempo !== "")
      payOut.unidadTiempo = pay.unidadTiempo;
    out.push(payOut);
  }
  return { ok: true, value: out };
}

function buildAdicionales(values: InvoiceFormValues): CreateInvoice["adicionales"] {
  const out = values.adicionales
    .filter((a) => a.nombre !== "" && a.valor !== "")
    .map((a) => ({ nombre: a.nombre, valor: a.valor }));
  return out.length === 0 ? undefined : out;
}

export function toCreateInvoicePayload(values: InvoiceFormValues): ToPayloadResult<CreateInvoice> {
  if (values.emissionPointId === "") {
    return {
      ok: false,
      reason: "punto de emisión requerido",
      fieldPath: "emissionPointId",
    };
  }
  if (values.customerId === "") {
    return { ok: false, reason: "cliente requerido", fieldPath: "customerId" };
  }
  if (values.fechaEmision === "") {
    return { ok: false, reason: "fecha requerida", fieldPath: "fechaEmision" };
  }
  const lines = buildLines(values);
  if (!lines.ok) return lines;
  const payments = buildPayments(values);
  if (!payments.ok) return payments;
  const adicionales = buildAdicionales(values);
  const payload: CreateInvoice = {
    emissionPointId: brand<CreateInvoice["emissionPointId"]>(values.emissionPointId),
    customerId: brand<NonNullable<CreateInvoice["customerId"]>>(values.customerId),
    fechaEmision: brand<CreateInvoice["fechaEmision"]>(values.fechaEmision),
    lines: lines.value,
    payments: payments.value,
  };
  if (adicionales !== undefined) payload.adicionales = adicionales;
  return { ok: true, value: payload };
}

export function toUpdateInvoicePayload(values: InvoiceFormValues): ToPayloadResult<UpdateInvoice> {
  // For PATCH we exclude `emissionPointId` (server rejects changing it on
  // PATCH per the spec) and `customerId` (only when it's actually set).
  const r = toCreateInvoicePayload(values);
  if (!r.ok) return r;
  const update: UpdateInvoice = {
    customerId: r.value.customerId,
    fechaEmision: r.value.fechaEmision,
    lines: r.value.lines,
    payments: r.value.payments,
  };
  if (r.value.adicionales !== undefined) update.adicionales = r.value.adicionales;
  return { ok: true, value: update };
}
