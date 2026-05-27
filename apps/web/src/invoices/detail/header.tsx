/**
 * `<Header />` — top section of the invoice detail page
 * (SPEC-0043 §FR-2).
 *
 * Shows:
 *   - estado badge + SRI estado badge.
 *   - claveAcceso (groups of 4 + copy button) when present.
 *   - numeroAutorizacion + fechaAutorizacion when present.
 *   - ambiente badge (Pruebas vs Producción).
 *   - "Sincronizando con SRI…" status when polling is active.
 *
 * PURE: no fetches, no side effects.
 */
import type { ReactElement } from "react";

import type { InvoiceDetail } from "@facturador/contracts/invoices";

import { t } from "../../i18n/es.js";
import { EstadoBadge, SriEstadoBadge } from "../list/estado-badge.js";

import { ClaveAccesoChip } from "./clave-acceso-chip.js";

/**
 * Format an SRI authorization datetime as `DD/MM/YYYY HH:mm`.
 * The contract is an ISO-8601 with offset; we render in UTC to keep
 * the test deterministic across runner timezones.
 */
function formatFechaAuth(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function ambienteLabel(ambiente: "1" | "2"): string {
  return ambiente === "1"
    ? t("invoice.detail.header.ambiente.1")
    : t("invoice.detail.header.ambiente.2");
}

export interface HeaderProps {
  readonly detail: InvoiceDetail;
  /** True when bounded polling is currently active. Drives a "live" hint. */
  readonly isPolling?: boolean;
}

export function Header({ detail, isPolling = false }: HeaderProps): ReactElement {
  const { invoice, sriDocument } = detail;
  const claveAcceso = invoice.claveAcceso ?? sriDocument?.claveAcceso ?? null;
  const sriEstado = sriDocument?.estado ?? null;
  const numeroAutorizacion = sriDocument?.numeroAutorizacion ?? null;
  const fechaAutorizacion = sriDocument?.fechaAutorizacion ?? null;
  const ambiente = sriDocument?.ambiente ?? null;

  return (
    <section
      data-testid="detail-header"
      className="space-y-3 rounded border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("invoice.detail.header.estado")}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <EstadoBadge estado={invoice.estado} />
            <SriEstadoBadge estado={sriEstado} />
          </div>
        </div>

        {ambiente !== null && (
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("invoice.detail.header.ambiente")}
            </span>
            <span
              data-testid={`ambiente-badge-${ambiente}`}
              className="mt-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
            >
              {ambienteLabel(ambiente)}
            </span>
          </div>
        )}

        {isPolling && (
          <span
            data-testid="detail-polling-indicator"
            role="status"
            aria-live="polite"
            className="ml-auto inline-flex items-center gap-2 text-xs text-slate-600"
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500"
              aria-hidden="true"
            />
            {t("invoice.detail.header.polling")}
          </span>
        )}
      </div>

      {claveAcceso !== null && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("invoice.detail.header.claveAcceso")}
          </span>
          <ClaveAccesoChip clave={claveAcceso} />
        </div>
      )}

      {numeroAutorizacion !== null && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("invoice.detail.header.numeroAutorizacion")}
          </span>
          <span data-testid="numero-autorizacion" className="font-mono text-xs text-slate-700">
            {numeroAutorizacion}
          </span>
        </div>
      )}

      {fechaAutorizacion !== null && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("invoice.detail.header.fechaAutorizacion")}
          </span>
          <span data-testid="fecha-autorizacion" className="text-xs text-slate-700">
            {formatFechaAuth(fechaAutorizacion)}
          </span>
        </div>
      )}
    </section>
  );
}
