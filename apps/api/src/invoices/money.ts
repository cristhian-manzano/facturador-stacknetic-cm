/**
 * Money math primitives for SPEC-0032.
 *
 * Source of truth:
 *   - SPEC-0032 §6.2 (`compute-totals.ts`).
 *   - PLAN-0032 §3 "Money math contract".
 *   - docs/sri-facturacion-electronica-ecuador.md §7-8 (precision rules).
 *
 * Hard rules captured here:
 *
 *   - `Number` is NEVER used for monetary arithmetic. All math runs through
 *     `Decimal` from `decimal.js`. Lint + code-review catches accidental
 *     `+` / `*` on plain numbers.
 *   - Rounding is HALF_UP at 2 decimal places for totals/money, and at 6
 *     decimal places for `cantidad`/`precioUnitario` (the SRI ficha-técnica
 *     §8 quantity pattern). HALF_UP matches the SRI examples and the
 *     standard accounting convention in Ecuador — banker's rounding would
 *     introduce a ±0.005 drift on edge totals that the SRI reception layer
 *     would flag as a totals_mismatch.
 *   - Conversions to `Number` happen ONLY at API boundaries (HTTP response
 *     JSON, Prisma `Decimal -> Decimal` doesn't need it). Use the explicit
 *     `decimalToNumber` helper so the call site is grep-able.
 *
 * Why decimal.js and not BigInt?
 *
 *   - The SRI ficha-técnica uses 6-decimal `cantidad`/`precioUnitario` and
 *     2-decimal money totals. BigInt would require a fixed integer base
 *     (e.g. multiply by 1e6, then split for display) and lose readability;
 *     decimal.js handles mixed-scale arithmetic directly with deterministic
 *     rounding modes.
 *   - decimal.js is pure JS (no native add-on), so it works under the same
 *     constraints as the test harness.
 */
import Decimal from "decimal.js";

/**
 * `Decimal` configuration — applied globally to the imported constructor.
 * decimal.js mutates its constructor singleton, so we set the precision +
 * rounding once at module load and assume it. The values are:
 *
 *   - `precision: 40` — comfortable headroom past the 12 + 6 digit ceiling.
 *   - `rounding: ROUND_HALF_UP` — see the module header for the rationale.
 *
 * We DON'T set `toExpNeg`/`toExpPos`/`toExpPosLow` because all our outputs
 * use `toFixed` or `toDecimalPlaces` which bypass exponent formatting.
 */
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

/** Number of decimal places for monetary amounts (totals, line subtotals). */
export const MONEY_DP = 2;

/** Number of decimal places for `cantidad` and `precioUnitario`. */
export const QTY_DP = 6;

/**
 * Round a `Decimal` to {@link MONEY_DP} (HALF_UP) and return another
 * `Decimal`. Use this everywhere a money total is computed.
 */
export function round2(value: Decimal | string | number): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Round a `Decimal` to {@link QTY_DP} (HALF_UP) and return another
 * `Decimal`. Use this when a `cantidad` or `precioUnitario` is computed
 * (rare; we usually accept the input).
 */
export function round6(value: Decimal | string | number): Decimal {
  return new Decimal(value).toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Convert a `Decimal` to a plain `number` with 2-decimal precision. ONLY
 * use this at API/serialisation boundaries — never in compute paths.
 *
 * The conversion goes via `toFixed(2)` then `parseFloat`. This is safe
 * because the source value has been HALF_UP-rounded to 2 dp; representable
 * doubles in [0, 1e12] always recover the same 2 dp value (1e12 ≪ 2^53).
 */
export function decimalToNumber(value: Decimal): number {
  return Number.parseFloat(value.toFixed(MONEY_DP));
}

/**
 * Format a `Decimal` as a 2-decimal-place STRING. Use this when the
 * downstream consumer expects a string ("100.00" rather than 100). This
 * is what Prisma's `Decimal` returns at the JSON boundary, and it is the
 * format the SRI XML builder expects per §7 of the ficha-técnica.
 */
export function decimalToMoneyString(value: Decimal): string {
  return value.toFixed(MONEY_DP);
}

/**
 * Sum a list of `Decimal | number | string` values, returning a `Decimal`
 * (NOT rounded — the caller decides when to round).
 *
 * Iterative `plus` rather than a fold because `Decimal.sum` mutates the
 * accumulator's precision implicitly; this loop is easier to reason about
 * in tests and produces identical results.
 */
export function sum(values: readonly (Decimal | number | string)[]): Decimal {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(v);
  return total;
}

/** Re-export `Decimal` so consumers don't need a duplicate import. */
export { Decimal };
