/**
 * `<ActionsBar />` — per-estado action buttons (SPEC-0043 §FR-2 +
 * TASKS-0043 §2.4).
 *
 * Visibility rules (mirrored from PROMPT-0043 §3):
 *
 *   | Action               | When                                           | Permission       |
 *   | -------------------- | ---------------------------------------------- | ---------------- |
 *   | Reintentar emisión   | estado=BORRADOR AND prior failure              | invoice.emit     |
 *   | Editar               | estado=BORRADOR                                | invoice.create   |
 *   | Eliminar             | estado=BORRADOR                                | invoice.create   |
 *   | Reissue              | sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}          | invoice.reissue  |
 *   | Sincronizar con SRI  | always (when there is a claveAcceso)           | invoice.read     |
 *   | Descargar XML        | sriEstado === AUTORIZADO                       | invoice.read     |
 *   | Imprimir RIDE        | sriEstado === AUTORIZADO                       | invoice.read     |
 *
 * Hard rules:
 *   - The "prior failure" gate (Reintentar) reads `sriEstado` and
 *     allows the button when it's one of {DEVUELTA, NO_AUTORIZADO,
 *     ERROR_RED, ERROR_BUILD}. A BORRADOR that has never been emitted
 *     would have sriEstado=null → button hidden.
 *   - "Descargar XML autorizado" and "Imprimir RIDE" are PLACEHOLDERS
 *     in v1: clicking them fires a "Próximamente" toast and does
 *     NOTHING ELSE. We never accept blob downloads that aren't wired.
 *   - VIEWER role has only `invoice.read`; so they see only
 *     "Sincronizar con SRI" + the AUTORIZADO placeholders.
 *
 * Permissions read from `useAuth().permissions` (server is the
 * authority — this is UI gating).
 */
import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import type { Action } from "@facturador/utils/rbac";
import type { InvoiceDetail } from "@facturador/contracts/invoices";

import { ApiError } from "../../lib/api.js";
import { useAuth } from "../../auth/context.js";
import { t } from "../../i18n/es.js";
import { deleteInvoice, emitInvoice, refreshInvoice, reissueInvoice } from "../api.js";

/** True if a previous emission failed. */
function hadPriorFailure(detail: InvoiceDetail): boolean {
  const sriEstado = detail.sriDocument?.estado ?? null;
  if (sriEstado === null) return false;
  return (
    sriEstado === "DEVUELTA" ||
    sriEstado === "NO_AUTORIZADO" ||
    sriEstado === "ERROR_RED" ||
    sriEstado === "ERROR_BUILD"
  );
}

/** True if reissue is permitted by business rule. */
function isReissueAllowed(detail: InvoiceDetail): boolean {
  const sriEstado = detail.sriDocument?.estado ?? null;
  return sriEstado === "DEVUELTA" || sriEstado === "NO_AUTORIZADO";
}

export interface ActionsBarProps {
  readonly detail: InvoiceDetail;
  /** Callback to surface a toast (variant + message). */
  readonly onToast: (message: string, variant?: "info" | "success" | "error") => void;
  /** Callback called after the detail mutated (refresh / emit). */
  readonly onMutated?: (next?: InvoiceDetail) => void;
  /** Test seam: skip the `window.confirm` for delete. */
  readonly skipConfirm?: boolean;
}

interface ButtonSpec {
  readonly key: string;
  readonly label: string;
  readonly onClick: () => void | Promise<void>;
  readonly visible: boolean;
  readonly testId: string;
  readonly variant?: "primary" | "danger" | "default";
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

function buttonClasses(spec: ButtonSpec): string {
  const base =
    "rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  if (spec.variant === "primary") {
    return `${base} bg-primary-600 text-white hover:bg-primary-700`;
  }
  if (spec.variant === "danger") {
    return `${base} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`;
  }
  return `${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
}

export function ActionsBar({
  detail,
  onToast,
  onMutated,
  skipConfirm = false,
}: ActionsBarProps): ReactElement {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const has = (action: Action): boolean => permissions.includes(action);

  const [pending, setPending] = useState<string | null>(null);

  const { invoice, sriDocument } = detail;
  const isBorrador = invoice.estado === "BORRADOR";
  const isAutorizado = (sriDocument?.estado ?? null) === "AUTORIZADO";
  const canRefresh = invoice.claveAcceso !== null || sriDocument !== null;

  // ----- handlers -------------------------------------------------------

  async function onRetryEmit(): Promise<void> {
    setPending("retry");
    try {
      await emitInvoice(invoice.id);
      onToast(t("invoice.detail.actions.retryEmit") + " ✓", "success");
      onMutated?.();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.problem.title : t("invoice.detail.actions.error.generic");
      onToast(msg, "error");
    } finally {
      setPending(null);
    }
  }

  async function onRefresh(): Promise<void> {
    setPending("refresh");
    try {
      const next = await refreshInvoice(invoice.id);
      onToast(t("invoice.detail.actions.refresh") + " ✓", "success");
      onMutated?.(next);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.problem.title : t("invoice.detail.actions.error.generic");
      onToast(msg, "error");
    } finally {
      setPending(null);
    }
  }

  async function onReissue(): Promise<void> {
    setPending("reissue");
    try {
      const res = await reissueInvoice(invoice.id);
      onToast(t("invoice.detail.actions.reissue") + " ✓", "success");
      navigate(`/invoices/${encodeURIComponent(res.newInvoiceId)}/edit`);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.problem.title : t("invoice.detail.actions.error.generic");
      onToast(msg, "error");
    } finally {
      setPending(null);
    }
  }

  async function onDelete(): Promise<void> {
    if (!skipConfirm) {
      const ok =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(t("invoice.detail.actions.delete.confirm"))
          : true;
      if (!ok) return;
    }
    setPending("delete");
    try {
      await deleteInvoice(invoice.id);
      navigate("/invoices");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.problem.title : t("invoice.detail.actions.error.generic");
      onToast(msg, "error");
    } finally {
      setPending(null);
    }
  }

  function onEdit(): void {
    navigate(`/invoices/${encodeURIComponent(invoice.id)}/edit`);
  }

  function onDownloadXml(): void {
    onToast(t("invoice.detail.actions.comingSoon"), "info");
  }

  function onPrintRide(): void {
    onToast(t("invoice.detail.actions.comingSoon"), "info");
  }

  // ----- visibility matrix ----------------------------------------------

  const buttons: readonly ButtonSpec[] = [
    {
      key: "retry",
      label: t("invoice.detail.actions.retryEmit"),
      onClick: onRetryEmit,
      visible: isBorrador && hadPriorFailure(detail) && has("invoice.emit"),
      testId: "action-retry-emit",
      variant: "primary",
      busy: pending === "retry",
      disabled: pending !== null,
    },
    {
      key: "edit",
      label: t("invoice.detail.actions.edit"),
      onClick: onEdit,
      visible: isBorrador && has("invoice.create"),
      testId: "action-edit",
      disabled: pending !== null,
    },
    {
      key: "delete",
      label: t("invoice.detail.actions.delete"),
      onClick: onDelete,
      visible: isBorrador && has("invoice.create"),
      testId: "action-delete",
      variant: "danger",
      busy: pending === "delete",
      disabled: pending !== null,
    },
    {
      key: "reissue",
      label: t("invoice.detail.actions.reissue"),
      onClick: onReissue,
      visible: isReissueAllowed(detail) && has("invoice.reissue"),
      testId: "action-reissue",
      variant: "primary",
      busy: pending === "reissue",
      disabled: pending !== null,
    },
    {
      key: "refresh",
      label:
        pending === "refresh"
          ? t("invoice.detail.actions.refreshing")
          : t("invoice.detail.actions.refresh"),
      onClick: onRefresh,
      visible: canRefresh && has("invoice.read"),
      testId: "action-refresh",
      busy: pending === "refresh",
      disabled: pending !== null,
    },
    {
      key: "download-xml",
      label: t("invoice.detail.actions.downloadXml"),
      onClick: onDownloadXml,
      visible: isAutorizado && has("invoice.read"),
      testId: "action-download-xml",
    },
    {
      key: "print-ride",
      label: t("invoice.detail.actions.printRide"),
      onClick: onPrintRide,
      visible: isAutorizado && has("invoice.read"),
      testId: "action-print-ride",
    },
  ];

  const visible = buttons.filter((b) => b.visible);

  return (
    <section
      data-testid="actions-bar"
      aria-label={t("invoice.detail.actions.title")}
      className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-3"
    >
      {visible.length === 0 ? (
        <span className="text-xs text-slate-500">—</span>
      ) : (
        visible.map((b) => (
          <button
            key={b.key}
            type="button"
            data-testid={b.testId}
            disabled={b.disabled ?? false}
            aria-busy={b.busy ?? false}
            onClick={() => void b.onClick()}
            className={buttonClasses(b)}
          >
            {b.label}
          </button>
        ))
      )}
    </section>
  );
}
