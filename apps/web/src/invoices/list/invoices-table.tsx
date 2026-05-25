/**
 * `<InvoicesTable />` — the table proper (SPEC-0043 §FR-1).
 *
 * Columns: Fecha, Cliente, Estab-Pto-Sec, Total, Estado (badge), SRI
 * estado (badge), Acciones. Clicking a row navigates to the detail
 * page.
 *
 * Hard rules:
 *   - NEVER render API content as raw HTML; everything text-escapes via
 *     React.
 *   - NEVER show teléfonos / emails on the list (the list endpoint
 *     intentionally doesn't return them; we re-confirm by NOT reading
 *     them even if they appear).
 *   - Money via `formatMoney` (es-EC, two decimals).
 *   - Date via `Intl.DateTimeFormat("es-EC")`.
 *
 * Accessibility:
 *   - Real `<table>` with `<thead>` / `<tbody>` so screen readers know
 *     it's tabular data.
 *   - Each row is a `<tr>`; the "Ver detalle" link inside the actions
 *     cell is keyboard-focusable. The whole row also navigates on click
 *     for mouse users.
 */
import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { InvoiceListItem } from "@facturador/contracts/invoices";

import { formatMoney } from "../money.js";
import { t } from "../../i18n/es.js";
import { EstadoBadge, SriEstadoBadge } from "./estado-badge.js";

/** Format an ISO date string as Spanish-Ecuadorian `DD/MM/YYYY`. */
export function formatFechaEs(iso: string): string {
  // Parse out the date parts manually — `Intl.DateTimeFormat` would
  // shift to the runner's local timezone, which could change the day.
  // The API contract is `YYYY-MM-DD` (IsoDateSchema), so a plain split
  // is safe.
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datePart);
  if (m === null) return iso;
  const [, y, mo, d] = m;
  return `${d ?? ""}/${mo ?? ""}/${y ?? ""}`;
}

/** "001-001-000000001" (or "001-001-—" when no secuencial yet). */
function formatEstabPtoSec(item: InvoiceListItem): string {
  const sec = item.secuencial ?? "—";
  return `${item.estab}-${item.ptoEmi}-${sec}`;
}

export interface InvoicesTableProps {
  readonly items: readonly InvoiceListItem[];
}

export function InvoicesTable({ items }: InvoicesTableProps): ReactElement {
  const navigate = useNavigate();
  return (
    <div
      data-testid="invoices-table-wrapper"
      className="overflow-x-auto rounded border border-slate-200"
    >
      <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr data-testid="invoices-table-header">
            <th scope="col" className="px-3 py-2">
              {t("invoice.list.col.fecha")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoice.list.col.cliente")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoice.list.col.estabPto")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t("invoice.list.col.total")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoice.list.col.estado")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoice.list.col.sriEstado")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t("invoice.list.col.acciones")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr
              key={item.id}
              data-testid={`invoice-row-${item.id}`}
              onClick={(ev) => {
                // Ignore clicks that originate on the action link (it
                // already navigates; we don't want a double-fire).
                if ((ev.target as HTMLElement).closest("a") !== null) return;
                navigate(`/invoices/${encodeURIComponent(item.id)}`);
              }}
              className="cursor-pointer hover:bg-slate-50"
            >
              <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                {formatFechaEs(item.fechaEmision)}
              </td>
              <td className="px-3 py-2 text-slate-900">
                {/* PII: razón social is fine; emails / phones are NOT
                    returned by the list endpoint and we never display them
                    here even defensively. */}
                {item.customerRazonSocial}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                {formatEstabPtoSec(item)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-900">
                {formatMoney(item.importeTotal)}
              </td>
              <td className="px-3 py-2">
                <EstadoBadge estado={item.estado} />
              </td>
              <td className="px-3 py-2">
                <SriEstadoBadge estado={item.sriEstado} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Link
                  to={`/invoices/${encodeURIComponent(item.id)}`}
                  data-testid={`invoice-row-link-${item.id}`}
                  className="text-sm font-medium text-primary-700 underline-offset-2 hover:underline"
                >
                  {t("invoice.list.row.openDetail")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
