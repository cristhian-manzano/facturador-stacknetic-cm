/**
 * `/invoices/:id/edit` route — load existing draft
 * (SPEC-0042 §FR-1 / TASKS-0042 §1.2).
 *
 * Loads the draft via `getInvoiceDetail`; if the invoice has been emitted
 * (estado !== BORRADOR) we show a banner with a link to the detail page.
 * Otherwise we render the same `<InvoiceForm />` with hydrated values.
 *
 * Wrapped in `<RequirePermission action="invoice.create">` (matches the
 * spec: editing a draft is part of the create flow).
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { InvoiceDetail } from "@facturador/contracts/invoices";

import { RequirePermission } from "../auth/RequirePermission.js";
import { ApiError } from "../lib/api.js";
import { t } from "../i18n/es.js";
import { getInvoiceDetail } from "../invoices/api.js";
import { InvoiceForm } from "../invoices/form/invoice-form.js";
import type { InvoiceFormValues } from "../invoices/form/types.js";

function detailToFormValues(detail: InvoiceDetail): InvoiceFormValues {
  const inv = detail.invoice;
  return {
    emissionPointId: inv.emissionPointId,
    customerId: inv.customerId,
    fechaEmision: inv.fechaEmision,
    lines: inv.lines.map((l) => {
      const iva = l.impuestos[0];
      return {
        descripcion: l.descripcion,
        cantidad: String(l.cantidad),
        precioUnitario: String(l.precioUnitario),
        descuento: String(l.descuento),
        codigoPorcentaje: iva?.codigoPorcentaje ?? "4",
        tarifa: iva?.tarifa ?? 15,
      };
    }),
    payments: inv.payments.map((p) => {
      const v: {
        formaPago: typeof p.formaPago;
        total: string;
        plazo?: string;
        unidadTiempo?: string;
      } = {
        formaPago: p.formaPago,
        total: String(p.total),
      };
      if (p.plazo !== undefined) v.plazo = String(p.plazo);
      if (p.unidadTiempo !== undefined) v.unidadTiempo = p.unidadTiempo;
      return v;
    }),
    adicionales: inv.adicionales.map((a) => ({ nombre: a.nombre, valor: a.valor })),
  };
}

export function InvoicesEditPage(): ReactElement {
  const params = useParams();
  const id = params.id ?? "";
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === "") return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getInvoiceDetail(id, controller.signal)
      .then((d) => {
        setDetail(d);
      })
      .catch((err: unknown) => {
        const name = (err as { name?: string }).name;
        if (name === "AbortError") return;
        if (err instanceof ApiError) {
          setError(err.problem.title);
        } else {
          setError(t("invoice.form.error.generic"));
        }
      })
      .finally(() => { setLoading(false); });
    return (): void => { controller.abort(); };
  }, [id]);

  const initial = useMemo<InvoiceFormValues | undefined>(
    () => (detail !== null ? detailToFormValues(detail) : undefined),
    [detail],
  );

  return (
    <RequirePermission action="invoice.create">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">{t("invoice.edit.title")}</h1>
        {loading && (
          <p role="status" aria-live="polite" className="mt-4 text-sm text-slate-600">
            Cargando…
          </p>
        )}
        {error !== null && (
          <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {!loading && detail !== null && detail.invoice.estado !== "BORRADOR" && (
          <div
            data-testid="invoice-locked-banner"
            role="alert"
            className="mt-4 rounded bg-amber-50 px-3 py-3 text-sm text-amber-900"
          >
            <p className="font-semibold">{t("invoice.edit.locked.title")}</p>
            <p className="mt-1">{t("invoice.edit.locked.body")}</p>
            <Link
              to={`/invoices/${encodeURIComponent(id)}`}
              className="mt-2 inline-block text-sm font-medium text-primary-700 underline"
            >
              {t("invoice.edit.locked.cta")}
            </Link>
          </div>
        )}
        {!loading &&
          detail !== null &&
          detail.invoice.estado === "BORRADOR" &&
          initial !== undefined && (
            <div className="mt-4">
              <InvoiceForm
                invoiceId={id}
                initial={initial}
                initialCustomerLabel={detail.customer.razonSocial}
              />
            </div>
          )}
      </section>
    </RequirePermission>
  );
}
