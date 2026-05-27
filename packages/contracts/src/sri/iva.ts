/**
 * `@facturador/contracts/sri/iva` — IVA rate catalog + `pickIvaCode`
 * default selector. The single source of truth used by:
 *
 *   - `apps/api`           — server-side validation + computeInvoice.
 *   - `apps/web`           — IVA dropdown + form payload assembly.
 *   - `apps/sri-core`      — XML builder whitelist (codigoPorcentaje set).
 *
 * Why this lives in `@facturador/contracts` (REVIEW-0042 §2):
 *
 *   - The web and api each had their own copy of `pickIvaCode` +
 *     `IVA_TABLE`. The pinned parity test caught drift today but two
 *     sources of truth is one bug away from "12% applies on the boundary
 *     in the API but 15% in the UI". Centralising kills the divergence.
 *   - `contracts` is the right home: it's the package both apps already
 *     depend on; no Node-runtime APIs are used.
 *
 * Authoritative sources:
 *   - SPEC-0032 §FR-6 (selector contract + validity windows).
 *   - PLAN-0032 §3 (pure function, returns `{codigo, porcentaje}`).
 *   - `docs/sri-facturacion-electronica-ecuador.md` §9 (codigoPorcentaje
 *     table).
 *   - PROMPT-0032 hard rule: 15% from 2024-04-01 onwards; 12% before.
 *
 * Hard rules captured here:
 *
 *   - `pickIvaCode` is PURE: no `Date.now()`, no `process.env`. It accepts
 *     a `Date` (already parsed by the caller from the user-supplied
 *     `YYYY-MM-DD`) OR an ISO date string `YYYY-MM-DD`. It returns the
 *     row that applies.
 *   - 2024-04-01 is the IVA-15% effective date (Decreto 198). Anything
 *     STRICTLY BEFORE this date returns 12% (`codigoPorcentaje="2"`); on
 *     and after, 15% (`codigoPorcentaje="4"`). The boundary tests cover
 *     the 2024-03-31 / 2024-04-01 case explicitly.
 *   - The function compares LOCAL CALENDAR DAYS (the `Y-M-D` triplet),
 *     NOT instants. The api caller passes a `Date` already normalised to
 *     local midnight (see `parseFechaEmision`); the web caller passes a
 *     `YYYY-MM-DD` straight from the form.
 *
 * `IVA_TABLE` is intentionally exposed so the web UI can render the
 * selector dropdown and the orchestrator can validate user-supplied
 * `(codigoPorcentaje, fechaEmision)` combinations.
 */

/** SRI impuesto `codigo` for IVA. Stable across all IVA percentages. */
export const IVA_CODIGO = "2";

/** SRI impuesto `codigo` for ICE — not selected here but referenced. */
export const ICE_CODIGO = "3";

/** SRI impuesto `codigo` for IRBPNR — plastic bottles. */
export const IRBPNR_CODIGO = "5";

/**
 * The 2024-04-01 boundary date (Decreto 198). Pinned as a constant so
 * tests can reference the boundary without re-encoding the literal.
 */
export const IVA_15_EFFECTIVE_FROM = "2024-04-01";

/**
 * One row of the IVA catalog. `validFrom` is the FIRST day the rate
 * applies (inclusive); `validTo` is the LAST day (inclusive). `null` on
 * either side means "open-ended".
 *
 * `label` is the UI string (Spanish) — co-located so the web dropdown
 * doesn't need a parallel labels table.
 */
export interface IvaCatalogRow {
  readonly codigo: typeof IVA_CODIGO;
  readonly codigoPorcentaje: string;
  /** Numeric percentage (0..100). `null` for diferenciado (catch-all). */
  readonly tarifa: number | null;
  /** First valid day (inclusive). `null` = open-start. */
  readonly validFrom: string | null;
  /** Last valid day (inclusive). `null` = open-end. */
  readonly validTo: string | null;
  /** UI label (Spanish). */
  readonly label: string;
}

/**
 * The full IVA `codigoPorcentaje` table per SRI catalog §9 + Decreto 198.
 *
 * Order matters: the web dropdown renders this list as-is, so the
 * default (15%) sits at the top for new lines after the 2024-04-01
 * boundary. Codes that didn't appear in the web catalog before
 * consolidation (3 — historic 2017 14%, 8 — diferenciado) are still
 * included; the web layer can filter the rendered subset as needed.
 */
export const IVA_TABLE: readonly IvaCatalogRow[] = [
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "4",
    tarifa: 15,
    validFrom: "2024-04-01",
    validTo: null,
    label: "15%",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "2",
    tarifa: 12,
    validFrom: null,
    validTo: "2024-03-31",
    label: "12% (histórico)",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "0",
    tarifa: 0,
    validFrom: null,
    validTo: null,
    label: "0%",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "6",
    tarifa: 0,
    validFrom: null,
    validTo: null,
    label: "No objeto IVA",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "7",
    tarifa: 0,
    validFrom: null,
    validTo: null,
    label: "Exento",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "5",
    tarifa: 5,
    validFrom: null,
    validTo: null,
    label: "5% construcción",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "3",
    tarifa: 14,
    validFrom: "2017-06-01",
    validTo: "2017-12-31",
    label: "14% (histórico 2017)",
  },
  {
    codigo: IVA_CODIGO,
    codigoPorcentaje: "8",
    tarifa: null,
    validFrom: null,
    validTo: null,
    label: "Diferenciado (otras)",
  },
];

/**
 * The selector result for the default IVA rate at a given fechaEmision.
 *
 * Always returns codigo "2" (IVA); the `codigoPorcentaje` switches between
 * "2" (12%) and "4" (15%) at the 2024-04-01 boundary.
 */
export interface PickIvaCodeResult {
  readonly codigo: typeof IVA_CODIGO;
  readonly codigoPorcentaje: string;
  /** Percentage as a number (12 or 15). Always non-null for the selector. */
  readonly tarifa: number;
}

/**
 * Convert a `Date` to a calendar-day key `YYYY-MM-DD` in UTC. Callers
 * MUST pass a date already normalised to local-midnight Ecuador (which
 * `parseFechaEmision` produces from the `YYYY-MM-DD` string the user
 * sends). We then read the UTC `Y-M-D` because the construction path
 * built the Date with `Date.UTC(y, m-1, d)`.
 */
function toCalendarDay(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compare two `YYYY-MM-DD` strings lexicographically. Stable + total.
 * Returns negative if `a < b`, zero if equal, positive if `a > b`.
 */
function cmpDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalise input to a `YYYY-MM-DD` string. Accepts:
 *
 *   - `Date` — read as UTC Y-M-D (callers pre-normalise to local midnight
 *     before calling). This is how `apps/api`'s validate.ts shapes data.
 *   - `string` — assumed to be `YYYY-MM-DD` already (web form input).
 *
 * Anything else (number, null, malformed string) is a programmer error;
 * the helper would just return the string unchanged and a downstream
 * comparison would mis-fire. We don't throw for the same reason the
 * legacy implementations didn't: callers in both apps have already Zod-
 * parsed the value before reaching the selector.
 */
function asDayKey(fechaEmision: Date | string): string {
  if (typeof fechaEmision === "string") return fechaEmision;
  return toCalendarDay(fechaEmision);
}

/**
 * Pick the default IVA rate row that applies to `fechaEmision`. This is
 * the ONLY function callers should use for the "give me today's IVA"
 * question. PURE: no I/O, no clock reads.
 *
 *   - `2024-03-31` and earlier → `{ codigo:"2", codigoPorcentaje:"2", tarifa:12 }`.
 *   - `2024-04-01` and later   → `{ codigo:"2", codigoPorcentaje:"4", tarifa:15 }`.
 *
 * Polymorphic input matches BOTH the api and web call-sites:
 *
 *   - API passes a `Date` (already pinned to local-midnight EC).
 *   - Web passes a `string` `YYYY-MM-DD` straight from the form.
 *
 * The function intentionally ignores rows whose `tarifa` is null (the
 * "diferenciado" / catch-all code 8) or whose tarifa is 0 (the various
 * exempt codes). Those are picked explicitly by the operator/UI when the
 * line is exempt; they are not defaults.
 */
export function pickIvaCode(fechaEmision: Date | string): PickIvaCodeResult {
  const day = asDayKey(fechaEmision);
  if (cmpDays(day, IVA_15_EFFECTIVE_FROM) >= 0) {
    return { codigo: IVA_CODIGO, codigoPorcentaje: "4", tarifa: 15 };
  }
  return { codigo: IVA_CODIGO, codigoPorcentaje: "2", tarifa: 12 };
}

/**
 * Validate that a `(codigoPorcentaje, fechaEmision)` pair is in its
 * validity window. Returns `true` if the row exists AND the date falls
 * within `[validFrom, validTo]` (inclusive on both ends).
 *
 * Used by the api validation layer to reject "user picked 12% for a 2025
 * invoice" before we hand off to compute.
 */
export function isIvaCodeValidFor(codigoPorcentaje: string, fechaEmision: Date | string): boolean {
  const row = IVA_TABLE.find((r) => r.codigoPorcentaje === codigoPorcentaje);
  if (row === undefined) return false;
  const day = asDayKey(fechaEmision);
  if (row.validFrom !== null && cmpDays(day, row.validFrom) < 0) return false;
  if (row.validTo !== null && cmpDays(day, row.validTo) > 0) return false;
  return true;
}

/**
 * Look up a catalog row by `codigoPorcentaje`. Returns `undefined` if the
 * code is unknown.
 */
export function getIvaRow(codigoPorcentaje: string): IvaCatalogRow | undefined {
  return IVA_TABLE.find((r) => r.codigoPorcentaje === codigoPorcentaje);
}
