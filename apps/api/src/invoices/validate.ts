/**
 * Business validations for invoice create/update payloads (SPEC-0032 §FR-3,
 * §FR-5, §FR-6).
 *
 * Source of truth:
 *   - SPEC-0032 §6.3 (validate-payload).
 *   - PLAN-0032 §3 + §4 Phase 3.
 *   - PROMPT-0032 §6 (security considerations).
 *
 * What lives here:
 *   - `parseFechaEmision(s)` — convert `YYYY-MM-DD` to a local-midnight Date.
 *     The string is the only contract — we never trust JS `Date.parse`'s
 *     timezone heuristic.
 *   - `formatFechaEmisionLocal(d)` — render `dd/mm/aaaa` for XML/RIDE.
 *   - `validateInvoicePayload(payload)` — defence-in-depth Zod parse +
 *     business rules. The Zod schema does shape; business rules check
 *     `(codigoPorcentaje, fechaEmision)` validity windows + future-date
 *     ceiling.
 *
 * Hard rules:
 *   - `fechaEmision > today + 1 day` (Ecuador local) → 422
 *     `invoice.fecha_invalida` (SPEC-0032 AC-2).
 *   - IVA `codigoPorcentaje="2"` (12%) with `fechaEmision >= 2024-04-01` →
 *     422 `invoice.tarifa_iva_invalida`.
 *   - IVA `codigoPorcentaje="4"` (15%) with `fechaEmision < 2024-04-01` →
 *     422 `invoice.tarifa_iva_invalida`.
 *
 * The `now` parameter is dependency-injected so tests can pin time without
 * touching `Date.now()`. The function is pure given `now`.
 */
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  type CreateInvoice,
  type UpdateInvoice,
} from "@facturador/contracts/invoices";
import { BusinessError, ValidationError } from "@facturador/utils/errors";
import { isIvaCodeValidFor } from "./tax-rates.js";

/**
 * Parse a `YYYY-MM-DD` string (Ecuador local date) into a `Date` whose
 * UTC components reflect the local date. We construct via `Date.UTC` so
 * the host TZ never shifts the calendar day.
 *
 * Throws `ValidationError` if the string does not match `YYYY-MM-DD` or
 * is not a real calendar date (e.g. "2024-02-30").
 */
export function parseFechaEmision(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) {
    throw new ValidationError("fechaEmision must be YYYY-MM-DD", {
      errors: [{ identificador: "fechaEmision", mensaje: "formato inválido", tipo: "ERROR" }],
    });
  }
  const y = Number.parseInt(m[1]!, 10);
  const mo = Number.parseInt(m[2]!, 10);
  const d = Number.parseInt(m[3]!, 10);
  const utc = Date.UTC(y, mo - 1, d);
  const dt = new Date(utc);
  // Round-trip the components to catch out-of-range dates like 2024-02-30.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new ValidationError("fechaEmision is not a valid calendar date", {
      errors: [{ identificador: "fechaEmision", mensaje: "fecha inválida", tipo: "ERROR" }],
    });
  }
  return dt;
}

/**
 * Format a UTC-midnight Date (the output of `parseFechaEmision`) as
 * `dd/mm/aaaa` for the XML builder. Uses the UTC components so the
 * calendar day from `parseFechaEmision` round-trips losslessly.
 */
export function formatFechaEmisionLocal(d: Date): string {
  const day = d.getUTCDate().toString().padStart(2, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  return `${day}/${month}/${year}`;
}

/**
 * Pure check: is `fechaEmision` no later than `now + 1 day` (Ecuador local)?
 * The +1 day tolerance covers ambient TZ skew and matches SPEC-0032 AC-2.
 */
function isFechaEmisionAcceptable(fechaEmision: Date, now: Date): boolean {
  // Reduce `now` to its local-midnight Ecuador equivalent by reading UTC
  // components (the caller is expected to have built `now` consistently
  // with `parseFechaEmision`; tests inject `Date.UTC(y,m,d)` directly).
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const oneDay = 24 * 60 * 60 * 1000;
  return fechaEmision.getTime() <= nowDay + oneDay;
}

/**
 * Parse + validate a create-invoice body. Returns a strongly-typed object
 * AND the parsed `Date` for fechaEmision so the handler doesn't have to
 * re-parse.
 *
 * Throws:
 *   - `ValidationError` (400) for shape errors via Zod.
 *   - `BusinessError("invoice.fecha_invalida", 422)` for future-dated.
 *   - `BusinessError("invoice.tarifa_iva_invalida", 422)` for code/window mismatch.
 */
export function validateCreatePayload(
  raw: unknown,
  options: { now: Date },
): { parsed: CreateInvoice; fechaEmision: Date } {
  const parsed = CreateInvoiceSchema.parse(raw);
  const fechaEmision = parseFechaEmision(parsed.fechaEmision);
  if (!isFechaEmisionAcceptable(fechaEmision, options.now)) {
    throw new BusinessError(
      "fechaEmision is in the future beyond the tolerance window",
      "invoice.fecha_invalida",
    );
  }
  assertTarifasMatchFecha(parsed.lines, fechaEmision);
  return { parsed, fechaEmision };
}

/**
 * Parse + validate an update-invoice body. Same checks as create, but
 * every top-level field is optional and we only run the IVA-window check
 * when lines + fechaEmision are both present.
 *
 * Returns the parsed body, optionally including a resolved Date if
 * `fechaEmision` was provided.
 */
export function validateUpdatePayload(
  raw: unknown,
  options: { now: Date },
): { parsed: UpdateInvoice; fechaEmision: Date | null } {
  const parsed = UpdateInvoiceSchema.parse(raw);
  let fechaEmision: Date | null = null;
  if (parsed.fechaEmision !== undefined) {
    fechaEmision = parseFechaEmision(parsed.fechaEmision);
    if (!isFechaEmisionAcceptable(fechaEmision, options.now)) {
      throw new BusinessError(
        "fechaEmision is in the future beyond the tolerance window",
        "invoice.fecha_invalida",
      );
    }
  }
  // Only run window-validation when BOTH the date AND lines are present in
  // the same payload. If a partial PATCH only changes lines we trust the
  // existing fechaEmision row + the handler will re-validate against it.
  if (parsed.lines !== undefined && fechaEmision !== null) {
    assertTarifasMatchFecha(parsed.lines, fechaEmision);
  }
  return { parsed, fechaEmision };
}

/**
 * For every line's impuesto, verify the `(codigoPorcentaje, fechaEmision)`
 * pair lies in the IVA-table validity window. Throws
 * `BusinessError("invoice.tarifa_iva_invalida", 422)` on the first miss.
 */
function assertTarifasMatchFecha(
  lines: ReadonlyArray<{
    impuestos: ReadonlyArray<{ codigo: string; codigoPorcentaje: string }>;
  }>,
  fechaEmision: Date,
): void {
  for (const [idx, line] of lines.entries()) {
    for (const imp of line.impuestos) {
      // ICE (3) and IRBPNR (5) have their own tables — for v1 we only
      // validate IVA codes. Lines with codigo!=2 pass through (the
      // orchestrator will reject unsupported impuestos at build time).
      if (imp.codigo !== "2") continue;
      if (!isIvaCodeValidFor(imp.codigoPorcentaje, fechaEmision)) {
        throw new BusinessError(
          `IVA codigoPorcentaje "${imp.codigoPorcentaje}" is not valid for fechaEmision (line ${idx + 1})`,
          "invoice.tarifa_iva_invalida",
        );
      }
    }
  }
}
