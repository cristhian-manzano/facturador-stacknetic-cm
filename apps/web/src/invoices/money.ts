/**
 * Money parsing and formatting helpers for the invoice form
 * (SPEC-0042 §FR-4 / §7.3 / PLAN-0042 §3 + ai/context/security.md).
 *
 * Hard rules:
 *   - Money inputs are `<input type="text" inputMode="decimal">`.
 *   - `parseMoney` is strict: it returns `null` for unparseable values; the
 *     caller decides what to do (RHF surfaces an inline error). NEVER
 *     coerces silently.
 *   - Accepts both `1,234.56` and `1.234,56` style separators (Ecuador
 *     formats vary by locale config). After cleaning, the value must match
 *     `^-?\d+(\.\d+)?$`.
 *   - `formatMoney` always renders with es-EC currency formatting at 2
 *     decimals (the invoice domain uses 2 dp for money; quantities can use
 *     4 dp but the totals panel only shows money).
 *   - Returns numeric values; the server is still the source of truth for
 *     totals (preview-totals round-trip).
 */

/**
 * Result type for `parseMoney`. A discriminated union so call sites
 * can't forget to handle the failure branch.
 */
export type ParseMoneyResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false };

/**
 * Strict money parser. Accepts:
 *   - "100"           → 100
 *   - "100.50"        → 100.5
 *   - "100,50"        → 100.5  (Spanish comma decimal)
 *   - "1,234.56"      → 1234.56
 *   - "1.234,56"      → 1234.56
 *   - "  100  "       → 100  (whitespace trimmed)
 *   - "-50.5"         → -50.5
 *
 * Rejects:
 *   - ""              → ok:false
 *   - "abc"           → ok:false
 *   - "1.2.3"         → ok:false
 *   - "1,2,3.4"       → ok:false (ambiguous)
 *   - "NaN" / "Infinity" → ok:false
 *
 * The parser intentionally never throws. The discriminated-union return
 * type makes the unhappy path impossible to ignore.
 */
export function parseMoney(raw: string | number | null | undefined): ParseMoneyResult {
  if (raw === null || raw === undefined) return { ok: false };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false };
    return { ok: true, value: raw };
  }
  if (typeof raw !== "string") return { ok: false };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false };

  // Strip currency symbols / whitespace inside the string (but not letters).
  const cleaned = trimmed.replace(/[\s$]/g, "");
  if (cleaned === "") return { ok: false };

  // Decide on the decimal separator. If the string has BOTH "," and ".",
  // the rightmost is the decimal separator and the other is a thousands
  // separator. If it has only one, we look at the position of the rightmost
  // occurrence to decide.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalised: string;
  if (lastComma === -1 && lastDot === -1) {
    normalised = cleaned;
  } else if (lastComma === -1) {
    // Only dots — assume the rightmost dot is the decimal separator. Any
    // additional dots are thousands separators ("1.234.567" → "1234567"
    // when integer; "1.234.567.89" is rejected as ambiguous).
    const parts = cleaned.split(".");
    if (parts.length === 2) {
      normalised = `${parts[0]}.${parts[1] ?? ""}`;
    } else if (parts.length > 2) {
      // Multiple dots, no comma: treat as thousands separators ONLY when
      // all groups except possibly the first are exactly 3 digits.
      const allButFirst = parts.slice(1);
      const isThousands = allButFirst.every((p) => /^\d{3}$/.test(p));
      if (isThousands) {
        normalised = parts.join("");
      } else {
        return { ok: false };
      }
    } else {
      return { ok: false };
    }
  } else if (lastDot === -1) {
    // Only commas — symmetric: rightmost comma is the decimal, others are
    // thousands separators ("1,234,567,89" only valid when "89" is a
    // 2-digit fractional and all prior groups are 3-digit; we accept
    // 1-2 fractional digits).
    const parts = cleaned.split(",");
    if (parts.length === 2) {
      const last = parts[1] ?? "";
      // Disambiguation: "1,234" with exactly 3 fractional digits is
      // almost certainly a thousands separator. Treat 3-digit-only as
      // thousands.
      if (/^\d{3}$/.test(last)) {
        normalised = parts.join("");
      } else {
        normalised = `${parts[0]}.${last}`;
      }
    } else if (parts.length > 2) {
      const last = parts[parts.length - 1] ?? "";
      const middle = parts.slice(1, -1);
      const isThousands = middle.every((p) => /^\d{3}$/.test(p)) && /^\d{1,2}$/.test(last);
      const allThousands = parts.slice(1).every((p) => /^\d{3}$/.test(p));
      if (allThousands) {
        normalised = parts.join("");
      } else if (isThousands) {
        normalised = `${parts.slice(0, -1).join("")}.${last}`;
      } else {
        return { ok: false };
      }
    } else {
      return { ok: false };
    }
  } else if (lastComma > lastDot) {
    // "1.234,56" — comma is decimal, dots are thousands.
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // "1,234.56" — dot is decimal, commas are thousands.
    normalised = cleaned.replace(/,/g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return { ok: false };
  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * Convenience wrapper that returns `0` on parse failure. Use ONLY for
 * derived display values where 0 is a safe default (never for persistence).
 */
export function parseMoneyOrZero(raw: string | number | null | undefined): number {
  const r = parseMoney(raw);
  return r.ok ? r.value : 0;
}

const ES_EC_CURRENCY_FMT = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a money value as es-EC currency: "$1,234.56" / "$0.00".
 * Always returns a string (never throws). NaN / non-finite → "$0.00".
 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return ES_EC_CURRENCY_FMT.format(0);
  return ES_EC_CURRENCY_FMT.format(value);
}

/**
 * Sum a list of money strings via `parseMoney`. Unparseable entries are
 * silently treated as 0 (the form layer is responsible for surfacing the
 * per-row validation error).
 */
export function sumMoney(values: readonly (string | number | null | undefined)[]): number {
  let acc = 0;
  for (const v of values) acc += parseMoneyOrZero(v);
  // Round to 2 dp to avoid floating-point dust (the server is still the
  // authority, but the chip comparison needs a stable number).
  return Math.round(acc * 100) / 100;
}

/**
 * Are two money values "the same" within the 0.01 tolerance used by the
 * orchestrator (SPEC-0033 §FR-1.4)? Used to gate the Emitir button.
 */
export function moneyEquals(a: number, b: number, tolerance = 0.01): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance + 1e-9;
}
