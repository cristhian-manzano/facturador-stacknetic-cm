/**
 * `<EmptyState />` — first-class component for the empty-list case
 * (SPEC-0043 §FR-1 AC-1).
 *
 * Shows a friendly headline + lead copy + a primary CTA to
 * `/invoices/new`. The CTA is gated by `invoice.create` so a VIEWER
 * sees the empty state without the button.
 */
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/context.js";
import { t } from "../../i18n/es.js";

export function EmptyState(): ReactElement {
  const { permissions } = useAuth();
  const canCreate = permissions.includes("invoice.create");
  return (
    <div
      data-testid="invoices-empty"
      className="flex flex-col items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-16 text-center"
    >
      <h2 className="text-base font-semibold text-slate-900">{t("invoice.list.empty.title")}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-600">{t("invoice.list.empty.lead")}</p>
      {canCreate && (
        <Link
          to="/invoices/new"
          data-testid="invoices-empty-cta"
          className="mt-4 inline-flex items-center rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t("invoice.list.create")}
        </Link>
      )}
    </div>
  );
}
