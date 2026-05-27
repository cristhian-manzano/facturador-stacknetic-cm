/**
 * `<PaymentsPanel />` — read-only payments block on the detail page.
 *
 * The SRI catalog (forma de pago) maps the 2-digit code to a human
 * label. We keep a tiny lookup here; richer tables live in
 * `apps/web/src/invoices/tax-rates.ts` already.
 */
import type { ReactElement } from "react";

import type { Invoice } from "@facturador/contracts/invoices";

import { t } from "../../i18n/es.js";
import { formatMoney } from "../money.js";
import { FORMA_PAGO_TABLE } from "../tax-rates.js";

function labelFormaPago(codigo: string): string {
  const row = FORMA_PAGO_TABLE.find((r) => r.codigo === codigo);
  return row === undefined ? codigo : `${codigo} · ${row.label}`;
}

export interface PaymentsPanelProps {
  readonly invoice: Invoice;
}

export function PaymentsPanel({ invoice }: PaymentsPanelProps): ReactElement {
  return (
    <section
      data-testid="payments-panel"
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">{t("invoice.detail.payments.title")}</h2>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-2 py-1">
              {t("invoice.detail.payments.formaPago")}
            </th>
            <th scope="col" className="px-2 py-1 text-right">
              {t("invoice.detail.payments.total")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoice.payments.map((p, idx) => (
            <tr key={`${String(idx)}-${p.formaPago}`} data-testid={`payment-detail-${String(idx)}`}>
              <td className="px-2 py-1 text-slate-800">{labelFormaPago(p.formaPago)}</td>
              <td className="px-2 py-1 text-right font-medium text-slate-900">
                {formatMoney(p.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
