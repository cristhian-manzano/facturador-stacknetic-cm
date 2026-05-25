/**
 * `TotalsPanel` — sticky-right panel showing the API-computed totals
 * (SPEC-0042 §FR-5 / TASKS-0042 §2.4).
 *
 * The component is presentational — the hook owner (`InvoiceForm`) drives
 * the preview-totals call and passes the result here.
 *
 * The "Pagos no coinciden" chip flips when `paymentsBalanced === false`
 * (which is the form layer's responsibility — we never compute totals
 * client-side; we only compare the SUM of payment inputs against the
 * server-returned `importeTotal`).
 */
import type { ReactElement } from "react";
import type { PreviewTotalsResponse } from "@facturador/contracts/invoices";

import { formatMoney } from "../money.js";
import { t } from "../../i18n/es.js";

export interface TotalsPanelProps {
  readonly totals: PreviewTotalsResponse | null;
  readonly isPending: boolean;
  readonly paymentsBalanced: boolean;
}

function ivaTotal(totals: PreviewTotalsResponse): number {
  let acc = 0;
  for (const row of totals.totalConImpuestos) {
    if (row.codigo === "2") acc += row.valor;
  }
  return acc;
}

export function TotalsPanel({
  totals,
  isPending,
  paymentsBalanced,
}: TotalsPanelProps): ReactElement {
  const subtotal = totals?.totalSinImpuestos ?? 0;
  const iva = totals === null ? 0 : ivaTotal(totals);
  const total = totals?.importeTotal ?? 0;

  return (
    <aside
      aria-label={t("invoice.form.totals.title")}
      data-testid="totals-panel"
      className="sticky top-4 w-full rounded border border-slate-200 bg-white p-4 shadow-sm md:w-72"
    >
      <h3 className="text-sm font-semibold text-slate-900">{t("invoice.form.totals.title")}</h3>

      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">{t("invoice.form.totals.subtotal")}</dt>
          <dd data-testid="totals-subtotal" className="font-medium text-slate-900">
            {formatMoney(subtotal)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">{t("invoice.form.totals.iva")}</dt>
          <dd data-testid="totals-iva" className="font-medium text-slate-900">
            {formatMoney(iva)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-2">
          <dt className="text-slate-800 font-semibold">{t("invoice.form.totals.total")}</dt>
          <dd data-testid="totals-total" className="text-base font-semibold text-slate-900">
            {formatMoney(total)}
          </dd>
        </div>
      </dl>

      {isPending && (
        <p
          role="status"
          aria-live="polite"
          data-testid="totals-pending"
          className="mt-3 text-xs text-slate-500"
        >
          {t("invoice.form.totals.pending")}
        </p>
      )}

      {!paymentsBalanced && (
        <p
          role="alert"
          data-testid="payment-mismatch-chip"
          className="mt-3 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900"
        >
          {t("invoice.form.payment.mismatch")}
        </p>
      )}
    </aside>
  );
}
