/**
 * `<TotalsPanel />` (detail variant) — read-only totals block.
 *
 * Server-computed; we display Subtotal, IVA, Total. The shape mirrors
 * `Invoice.totalConImpuestos`: each entry is one tarifa row (codigo
 * `2` is IVA per the SRI catalog). We sum the `valor` column for the
 * IVA display since v1 invoices typically have a single rate.
 */
import type { ReactElement } from "react";
import type { Invoice } from "@facturador/contracts/invoices";

import { formatMoney } from "../money.js";
import { t } from "../../i18n/es.js";

export interface DetailTotalsPanelProps {
  readonly invoice: Invoice;
}

export function DetailTotalsPanel({ invoice }: DetailTotalsPanelProps): ReactElement {
  const ivaSum = invoice.totalConImpuestos
    .filter((r) => r.codigo === "2")
    .reduce((acc, r) => acc + r.valor, 0);
  return (
    <section
      data-testid="detail-totals-panel"
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">{t("invoice.detail.totals.title")}</h2>
      <dl className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">{t("invoice.detail.totals.subtotal")}</dt>
          <dd data-testid="totals-subtotal" className="font-medium text-slate-900">
            {formatMoney(invoice.totalSinImpuestos)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">{t("invoice.detail.totals.iva")}</dt>
          <dd data-testid="totals-iva" className="font-medium text-slate-900">
            {formatMoney(ivaSum)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-1">
          <dt className="text-slate-700">{t("invoice.detail.totals.total")}</dt>
          <dd data-testid="totals-total" className="font-semibold text-slate-900">
            {formatMoney(invoice.importeTotal)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
