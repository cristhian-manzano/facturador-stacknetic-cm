/**
 * `<CustomerPanel />` — customer block on the detail page
 * (SPEC-0043 §FR-2). READ-ONLY.
 *
 * Shows razón social, identificación, email, teléfono, dirección. PII
 * IS shown on the DETAIL view (per PROMPT-0043 §3: list view excludes
 * PII; detail view is fine).
 *
 * The customer block is a discriminated union by `tipoIdentificacion`,
 * so each branch may or may not have email / telefono / direccion. We
 * read them defensively (`?? null` → skip rendering when absent).
 */
import type { ReactElement } from "react";

import type { Customer } from "@facturador/contracts/customers";

import { t } from "../../i18n/es.js";

interface Row {
  readonly labelKey: Parameters<typeof t>[0];
  readonly value: string | null | undefined;
  readonly testid: string;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "") return null;
  return value;
}

export interface CustomerPanelProps {
  readonly customer: Customer;
}

export function CustomerPanel({ customer }: CustomerPanelProps): ReactElement {
  // `email`, `telefono`, `direccion` exist on most branches but are
  // optional everywhere. Read defensively.
  const c = customer as Customer & {
    email?: string;
    telefono?: string;
    direccion?: string;
  };
  const rows: readonly Row[] = [
    {
      labelKey: "invoice.detail.customer.razonSocial",
      value: customer.razonSocial,
      testid: "customer-razon-social",
    },
    {
      labelKey: "invoice.detail.customer.identificacion",
      value: `${customer.tipoIdentificacion} · ${customer.identificacion}`,
      testid: "customer-identificacion",
    },
    {
      labelKey: "invoice.detail.customer.email",
      value: asString(c.email),
      testid: "customer-email",
    },
    {
      labelKey: "invoice.detail.customer.telefono",
      value: asString(c.telefono),
      testid: "customer-telefono",
    },
    {
      labelKey: "invoice.detail.customer.direccion",
      value: asString(c.direccion),
      testid: "customer-direccion",
    },
  ];
  return (
    <section
      data-testid="customer-panel"
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">{t("invoice.detail.customer.title")}</h2>
      <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        {rows.map((row) =>
          row.value === null || row.value === undefined ? null : (
            <div key={row.testid} className="flex flex-col">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t(row.labelKey)}
              </dt>
              <dd data-testid={row.testid} className="text-slate-800">
                {row.value}
              </dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
