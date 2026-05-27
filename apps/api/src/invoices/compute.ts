/**
 * `computeInvoice(input)` — pure, decimal.js-backed totals for a factura.
 *
 * Source of truth:
 *   - SPEC-0032 §6.2 (compute-totals).
 *   - PLAN-0032 §3 (money math contract).
 *   - docs/sri-facturacion-electronica-ecuador.md §7-9.
 *   - PROMPT-0032 hard rules:
 *       - decimal.js only; no `Number` arithmetic.
 *       - HALF_UP at 2 dp for money totals; 6 dp for quantities.
 *       - Pure: no DB, no clock except the passed-in `fechaEmision`.
 *       - Inputs `{ fechaEmision, lines[], payments[] }` ; outputs include
 *         `paymentsBalanced`.
 *
 * Contract:
 *
 *   computeInvoice({
 *     fechaEmision: Date;
 *     lines: ComputeLineInput[];
 *     payments: ComputePaymentInput[];
 *     propina?: number | string;
 *     totalDescuento?: number | string;
 *   }): ComputeInvoiceResult
 *
 *   Outputs:
 *     {
 *       lineComputations: ComputeLineResult[]; // per-line subtotal + impuestos
 *       totalSinImpuestos: number;             // 2 dp
 *       totalDescuento: number;                // 2 dp (mirrored back; we don't fold line discounts into the header — they live on the lines)
 *       totalImpuestos: TaxBucket[];           // grouped per (codigo, codigoPorcentaje)
 *       propina: number;                       // 2 dp
 *       importeTotal: number;                  // 2 dp
 *       paymentsBalanced: boolean;             // |Σ payments.total - importeTotal| <= 0.01
 *     }
 *
 * Hard rules baked in:
 *
 *   - Each line: `precioTotalSinImpuesto = round2((cantidad * precioUnitario) - descuento)`.
 *   - Per impuesto: `baseImponible = precioTotalSinImpuesto`,
 *                   `valor = round2(baseImponible * tarifa / 100)`.
 *   - `totalSinImpuestos = round2(Σ line.precioTotalSinImpuesto)`.
 *   - Impuesto buckets group by `(codigo, codigoPorcentaje)`; bases + values
 *     are 2-dp rounded after every line addition (not at the end) so the
 *     stored value matches the SRI XSD validator's recomputation.
 *   - `importeTotal = round2(totalSinImpuestos - totalDescuento + Σ buckets.valor + propina)`.
 *   - `paymentsBalanced = |round2(Σ payments.total) - importeTotal| ≤ 0.01`.
 *
 * Determinism:
 *
 *   Same input → same output. The function depends only on its arguments;
 *   `Decimal.set` is module-level and never mutated per-call. Property
 *   tests rely on this for the "same input → same output" invariant.
 */
import { Decimal, MONEY_DP, round2, sum } from "./money.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** One impuesto on a line. */
export interface ComputeImpuestoInput {
  readonly codigo: string;
  readonly codigoPorcentaje: string;
  /** Percentage as a number (e.g. 15 for 15%). */
  readonly tarifa: number;
}

/** One line of the invoice (detalle). */
export interface ComputeLineInput {
  /** Line-visible order index. Carried through to the result for stability. */
  readonly orden: number;
  /** `cantidad` — accepts string or number; coerced to Decimal. */
  readonly cantidad: string | number | Decimal;
  /** `precioUnitario` — accepts string or number; coerced to Decimal. */
  readonly precioUnitario: string | number | Decimal;
  /** `descuento` — defaults to 0. */
  readonly descuento?: string | number | Decimal;
  /** At least one impuesto per line. */
  readonly impuestos: readonly ComputeImpuestoInput[];
}

/** One payment (forma de pago + monto). */
export interface ComputePaymentInput {
  readonly formaPago: string;
  readonly total: string | number | Decimal;
}

/** Full computeInvoice input. */
export interface ComputeInvoiceInput {
  /**
   * fechaEmision is part of the input contract (PROMPT-0032). The current
   * implementation only stores it on each impuesto bucket's response and
   * leaves IVA-rate selection to the caller (the orchestrator picks the
   * line-level tarifa via `pickIvaCode` before invoking compute). Future
   * versions could auto-select if no impuesto is present on a line.
   */
  readonly fechaEmision: Date;
  readonly lines: readonly ComputeLineInput[];
  readonly payments: readonly ComputePaymentInput[];
  /** Invoice-level discount. Default 0. */
  readonly totalDescuento?: string | number | Decimal;
  /** Invoice-level propina (10% servicio). Default 0. */
  readonly propina?: string | number | Decimal;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A single (codigo,codigoPorcentaje) bucket aggregated across lines. */
export interface TaxBucket {
  readonly codigo: string;
  readonly codigoPorcentaje: string;
  readonly tarifa: number;
  readonly baseImponible: number;
  readonly valor: number;
}

/** Per-line computed shape. */
export interface ComputeLineResult {
  readonly orden: number;
  readonly precioTotalSinImpuesto: number;
  readonly impuestos: readonly {
    readonly codigo: string;
    readonly codigoPorcentaje: string;
    readonly tarifa: number;
    readonly baseImponible: number;
    readonly valor: number;
  }[];
}

/** Full computeInvoice output. */
export interface ComputeInvoiceResult {
  readonly lineComputations: readonly ComputeLineResult[];
  readonly totalSinImpuestos: number;
  readonly totalDescuento: number;
  readonly totalImpuestos: readonly TaxBucket[];
  readonly propina: number;
  readonly importeTotal: number;
  readonly paymentsBalanced: boolean;
  /**
   * Absolute difference between Σ payments.total and importeTotal. Exposed
   * so the UI can render a chip with the exact gap on mismatch.
   */
  readonly paymentsDelta: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Convert a Decimal -> number with `toFixed(2)` precision. ONLY used for
 * the boundary between this pure function and its JSON-shaped output.
 */
function toMoney(d: Decimal): number {
  return Number.parseFloat(d.toFixed(MONEY_DP));
}

/**
 * Group key for a `(codigo, codigoPorcentaje)` bucket. We use a delimited
 * string (`<codigo>|<codigoPorcentaje>`) because objects can't be Map keys
 * without identity, and the delimiter "|" is illegal in SRI codes.
 */
function bucketKey(codigo: string, codigoPorcentaje: string): string {
  return `${codigo}|${codigoPorcentaje}`;
}

/**
 * Compute one line's `precioTotalSinImpuesto` + impuesto detail. Pure.
 *
 * Algorithm:
 *   1. `cantidad * precioUnitario` (no rounding here — we want max precision
 *      to feed into the round-down step).
 *   2. Subtract `descuento`.
 *   3. Round to 2 dp HALF_UP → `precioTotalSinImpuesto`.
 *   4. For each impuesto, `valor = round2(precioTotalSinImpuesto * tarifa / 100)`.
 */
function computeLine(line: ComputeLineInput): ComputeLineResult {
  const cantidad = new Decimal(line.cantidad);
  const precioUnit = new Decimal(line.precioUnitario);
  const descuento = new Decimal(line.descuento ?? 0);
  const rawSubtotal = cantidad.mul(precioUnit).minus(descuento);
  const precioTotalSinImpuesto = round2(rawSubtotal);

  const impuestos = line.impuestos.map((imp) => {
    const tarifa = new Decimal(imp.tarifa);
    // `valor = round2(base * tarifa / 100)`.
    const valor = round2(precioTotalSinImpuesto.mul(tarifa).div(100));
    return {
      codigo: imp.codigo,
      codigoPorcentaje: imp.codigoPorcentaje,
      tarifa: imp.tarifa,
      baseImponible: toMoney(precioTotalSinImpuesto),
      valor: toMoney(valor),
    };
  });

  return {
    orden: line.orden,
    precioTotalSinImpuesto: toMoney(precioTotalSinImpuesto),
    impuestos,
  };
}

/**
 * Compute totals for a complete factura. See module header for the full
 * contract. Pure function.
 */
export function computeInvoice(input: ComputeInvoiceInput): ComputeInvoiceResult {
  // 1. Per-line subtotals + tax detail.
  const lineComputations = input.lines.map(computeLine);

  // 2. Σ line.precioTotalSinImpuesto.
  const totalSinImpuestos = round2(sum(lineComputations.map((l) => l.precioTotalSinImpuesto)));

  // 3. Aggregate per (codigo, codigoPorcentaje). Round after each addition.
  const buckets = new Map<string, { tarifa: number; base: Decimal; valor: Decimal }>();
  // Preserve insertion order so the response shape is deterministic.
  const order: string[] = [];
  for (const line of lineComputations) {
    for (const imp of line.impuestos) {
      const key = bucketKey(imp.codigo, imp.codigoPorcentaje);
      const existing = buckets.get(key);
      if (existing === undefined) {
        buckets.set(key, {
          tarifa: imp.tarifa,
          base: round2(new Decimal(imp.baseImponible)),
          valor: round2(new Decimal(imp.valor)),
        });
        order.push(key);
      } else {
        existing.base = round2(existing.base.plus(imp.baseImponible));
        existing.valor = round2(existing.valor.plus(imp.valor));
      }
    }
  }
  const totalImpuestos: TaxBucket[] = order.map((key) => {
    const b = buckets.get(key);
    if (b === undefined) {
      // Unreachable: every key in `order` was just inserted into `buckets`.
      throw new Error(`Internal compute error: bucket ${key} missing`);
    }
    const [codigo, codigoPorcentaje] = key.split("|");
    if (codigo === undefined || codigoPorcentaje === undefined) {
      throw new Error(`Internal compute error: bad bucket key ${key}`);
    }
    return {
      codigo,
      codigoPorcentaje,
      tarifa: b.tarifa,
      baseImponible: toMoney(b.base),
      valor: toMoney(b.valor),
    };
  });

  // 4. Header totals.
  const totalDescuento = round2(input.totalDescuento ?? 0);
  const propina = round2(input.propina ?? 0);
  const sumImpuestos = sum(totalImpuestos.map((b) => b.valor));
  const importeTotal = round2(
    totalSinImpuestos.minus(totalDescuento).plus(sumImpuestos).plus(propina),
  );

  // 5. Payments balance check (±0.01 tolerance — SPEC-0032 FR-5).
  const paymentsSum = round2(sum(input.payments.map((p) => p.total)));
  const paymentsDelta = paymentsSum.minus(importeTotal).abs();
  const paymentsBalanced = paymentsDelta.lessThanOrEqualTo("0.01");

  return {
    lineComputations,
    totalSinImpuestos: toMoney(totalSinImpuestos),
    totalDescuento: toMoney(totalDescuento),
    totalImpuestos,
    propina: toMoney(propina),
    importeTotal: toMoney(importeTotal),
    paymentsBalanced,
    paymentsDelta: toMoney(paymentsDelta),
  };
}

/**
 * Convenience: assert the payments sum matches importeTotal. Used by the
 * orchestrator (SPEC-0033) at emit time and exposed via the PATCH
 * response's `paymentsBalanced` boolean.
 *
 * Throws `false` is returned by `computeInvoice` ; the orchestrator wraps
 * this into a `BusinessError("invoice.payment_mismatch")`.
 */
export function assertPaymentsMatchTotal(
  result: Pick<ComputeInvoiceResult, "paymentsBalanced" | "paymentsDelta" | "importeTotal">,
): void {
  if (!result.paymentsBalanced) {
    throw new Error(
      `Payments do not match importeTotal (delta=${String(result.paymentsDelta)}, total=${String(result.importeTotal)})`,
    );
  }
}
