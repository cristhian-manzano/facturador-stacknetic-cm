/**
 * `<EstadoBadge />` and `<SriEstadoBadge />` — small coloured pills.
 *
 * Two badge families:
 *
 *   - Invoice estado (BORRADOR / EMITIDO / ANULADO). Business-side only.
 *   - SRI estado (ten values per `SriEstadoSchema`).
 *
 * Why two? Estado is OUR domain; SRI estado is the upstream pipeline
 * marker. Showing them as distinct chips reads faster than one fused
 * status (per SPEC-0043 §FR-1 "Estado (badge), SRI estado (badge)").
 *
 * Rendering rules:
 *
 *   - PURE: receives the estado as a prop; no fetches.
 *   - Plain text inside the pill (NEVER raw HTML); the label is mapped
 *     via the `i18n/es.ts` table.
 *   - Accessible: each pill carries `role="status"` so screen readers
 *     announce a status, not just colour.
 */
import type { ReactElement } from "react";
import type { InvoiceEstado } from "@facturador/contracts/invoices";
import type { SriEstado } from "@facturador/contracts/sri";

import { cn } from "../../lib/cn.js";
import { t, type I18nKey } from "../../i18n/es.js";

interface BadgeStyle {
  readonly cls: string;
  readonly label: string;
}

function estadoStyle(estado: InvoiceEstado): BadgeStyle {
  switch (estado) {
    case "BORRADOR":
      return {
        cls: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
        label: t("invoice.estado.BORRADOR"),
      };
    case "EMITIDO":
      return {
        cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        label: t("invoice.estado.EMITIDO"),
      };
    case "ANULADO":
      return {
        cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        label: t("invoice.estado.ANULADO"),
      };
  }
}

function sriEstadoStyle(estado: SriEstado): BadgeStyle {
  const label = t(`invoice.sriEstado.${estado}` as I18nKey);
  switch (estado) {
    case "AUTORIZADO":
      return {
        cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        label,
      };
    case "EN_PROCESO":
    case "RECIBIDA":
    case "ENVIADO":
      return {
        cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
        label,
      };
    case "PENDIENTE":
    case "FIRMADO":
      return {
        cls: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
        label,
      };
    case "DEVUELTA":
    case "NO_AUTORIZADO":
      return {
        cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        label,
      };
    case "ERROR_RED":
    case "ERROR_BUILD":
      return {
        cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        label,
      };
  }
}

const BASE_CLASS = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export function EstadoBadge({ estado }: { readonly estado: InvoiceEstado }): ReactElement {
  const style = estadoStyle(estado);
  return (
    <span
      role="status"
      data-testid={`estado-badge-${estado}`}
      className={cn(BASE_CLASS, style.cls)}
    >
      {style.label}
    </span>
  );
}

export function SriEstadoBadge({
  estado,
}: {
  readonly estado: SriEstado | null | undefined;
}): ReactElement {
  if (estado === null || estado === undefined) {
    return (
      <span
        role="status"
        data-testid="sri-estado-badge-none"
        className={cn(BASE_CLASS, "bg-slate-50 text-slate-400 ring-1 ring-slate-200")}
      >
        {t("invoice.sriEstado.none")}
      </span>
    );
  }
  const style = sriEstadoStyle(estado);
  return (
    <span
      role="status"
      data-testid={`sri-estado-badge-${estado}`}
      className={cn(BASE_CLASS, style.cls)}
    >
      {style.label}
    </span>
  );
}
