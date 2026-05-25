/**
 * `<LinesPanel />` — read-only lines table on the detail page
 * (SPEC-0043 §FR-2).
 *
 * Columns: descripción, cantidad, precio unitario, descuento, subtotal.
 * Monetary cells right-aligned + `formatMoney` (es-EC, two decimals).
 */
import type { ReactElement } from "react";
import type { Invoice } from "@facturador/contracts/invoices";

import { formatMoney } from "../money.js";
import { t } from "../../i18n/es.js";

export interface LinesPanelProps {
  readonly invoice: Invoice;
}

export function LinesPanel({ invoice }: LinesPanelProps): ReactElement {
  return (
    <section
      data-testid="lines-panel"
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">{t("invoice.detail.lines.title")}</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-2 py-1">
                {t("invoice.detail.lines.descripcion")}
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                {t("invoice.detail.lines.cantidad")}
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                {t("invoice.detail.lines.precioUnitario")}
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                {t("invoice.detail.lines.descuento")}
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                {t("invoice.detail.lines.subtotal")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((l, idx) => (
              <tr key={`${idx}-${l.descripcion}`} data-testid={`line-detail-${idx}`}>
                <td className="px-2 py-1 text-slate-800">{l.descripcion}</td>
                <td className="px-2 py-1 text-right text-slate-700">{l.cantidad}</td>
                <td className="px-2 py-1 text-right text-slate-700">
                  {formatMoney(l.precioUnitario)}
                </td>
                <td className="px-2 py-1 text-right text-slate-700">{formatMoney(l.descuento)}</td>
                <td className="px-2 py-1 text-right font-medium text-slate-900">
                  {formatMoney(l.precioTotalSinImpuesto)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
