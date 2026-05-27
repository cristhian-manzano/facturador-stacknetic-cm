/**
 * `/invoices/new` route — creates a draft on first edit
 * (SPEC-0042 §FR-1 / TASKS-0042 §1.1).
 *
 * Wrapped in `<RequirePermission action="invoice.create">` so VIEWERs get
 * redirected to `/forbidden`.
 */
import type { ReactElement } from "react";

import { RequirePermission } from "../auth/RequirePermission.js";
import { t } from "../i18n/es.js";
import { InvoiceForm } from "../invoices/form/invoice-form.js";

export function InvoicesNewPage(): ReactElement {
  return (
    <RequirePermission action="invoice.create">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">{t("invoice.new.title")}</h1>
        <div className="mt-4">
          <InvoiceForm />
        </div>
      </section>
    </RequirePermission>
  );
}
