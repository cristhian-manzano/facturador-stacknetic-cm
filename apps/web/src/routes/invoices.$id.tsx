/**
 * `/invoices/:id` route — invoice detail with SRI timeline + bounded
 * polling (SPEC-0043 §FR-2 + TASKS-0043 §2).
 *
 * Behaviour:
 *   - Wrapped in `<RequirePermission action="invoice.read">`.
 *   - TanStack Query loads `getInvoiceDetail(id)`.
 *   - Bounded polling: `refetchInterval` returns 5000 ms while
 *     `sriEstado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}`, then `false`
 *     once 5 minutes have elapsed since polling started.
 *   - Polling pauses while the tab is hidden
 *     (`document.visibilityState === "hidden"`).
 *   - Header / panels / timeline / actions rendered as separate
 *     components.
 *   - Toast hint surfaces the placeholder actions
 *     ("Próximamente" / "Acción completada" / "Error").
 */
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { RequirePermission } from "../auth/RequirePermission.js";
import { ApiError } from "../lib/api.js";
import { t } from "../i18n/es.js";
import { getInvoiceDetail } from "../invoices/api.js";
import { ActionsBar } from "../invoices/detail/actions-bar.js";
import { ClaveAccesoChip as _ClaveAccesoChip } from "../invoices/detail/clave-acceso-chip.js";
import { CustomerPanel } from "../invoices/detail/customer-panel.js";
import { Header } from "../invoices/detail/header.js";
import { LinesPanel } from "../invoices/detail/lines-panel.js";
import { PaymentsPanel } from "../invoices/detail/payments-panel.js";
import { SriTimeline } from "../invoices/detail/sri-timeline.js";
import { DetailTotalsPanel } from "../invoices/detail/totals-panel.js";
import { useToast } from "../invoices/detail/useToast.js";
import {
  POLL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  isPollableEstado,
} from "../invoices/detail/polling.js";

// Re-export so consumers (and tests) can find the chip via the route module
// without reaching into the panels folder. Voided locally to avoid unused
// import warnings.
void _ClaveAccesoChip;

function detailQueryKey(id: string): QueryKey {
  return ["invoices", "detail", id];
}

function InvoicesDetailInner({ id }: { readonly id: string }): ReactElement {
  const queryClient = useQueryClient();
  const { toast, show: showToast } = useToast();

  /**
   * `pollStartedAtRef` tracks the wall-clock time of the FIRST poll
   * since the page entered a pollable estado. We reset it whenever the
   * estado transitions OUT of the pollable set, so a future regression
   * (estado flips back to EN_PROCESO) gets a fresh 5-minute budget.
   */
  const pollStartedAtRef = useRef<number | null>(null);

  const query = useQuery({
    queryKey: detailQueryKey(id),
    queryFn: ({ signal }) => getInvoiceDetail(id, signal),
    refetchOnWindowFocus: false,
    refetchInterval: (q): number | false => {
      const data = q.state.data;
      if (data === undefined) return false;
      const sriEstado = data.sriDocument?.estado ?? null;
      // Stop on terminal estados.
      if (!isPollableEstado(sriEstado)) {
        pollStartedAtRef.current = null;
        return false;
      }
      // Pause while the tab is hidden — we'll resume on visibility
      // change (handled by the focus listener below + a React re-render
      // triggered by the visibility event).
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      // First tick — record the start time.
      if (pollStartedAtRef.current === null) {
        pollStartedAtRef.current = Date.now();
        return POLL_INTERVAL_MS;
      }
      const elapsed = Date.now() - pollStartedAtRef.current;
      if (elapsed >= POLL_MAX_DURATION_MS) return false;
      return POLL_INTERVAL_MS;
    },
  });

  // Visibility-change handler: when the tab becomes visible again,
  // invalidate so TanStack Query reconsiders the refetchInterval.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        // Trigger a refetch attempt; the polling logic above will resume
        // from where it paused (the pollStartedAtRef is preserved).
        void queryClient.invalidateQueries({ queryKey: detailQueryKey(id) });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); };
  }, [id, queryClient]);

  const isPolling = useMemo(() => {
    if (query.data === undefined) return false;
    const sriEstado = query.data.sriDocument?.estado ?? null;
    if (!isPollableEstado(sriEstado)) return false;
    if (pollStartedAtRef.current === null) return true;
    const elapsed = Date.now() - pollStartedAtRef.current;
    return elapsed < POLL_MAX_DURATION_MS;
    // We deliberately depend on `query.data` so the indicator re-evaluates
    // after each refetch tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  if (query.status === "pending") {
    return (
      <p
        role="status"
        aria-live="polite"
        data-testid="detail-loading"
        className="text-sm text-slate-600"
      >
        {t("invoice.detail.loading")}
      </p>
    );
  }

  if (query.status === "error") {
    return (
      <div
        role="alert"
        data-testid="detail-error"
        className="space-y-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
      >
        <p className="font-semibold">{t("invoice.detail.error.title")}</p>
        <p>{query.error instanceof ApiError ? query.error.problem.title : query.error.message}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="rounded border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
        >
          {t("invoice.detail.error.retry")}
        </button>
      </div>
    );
  }

  const detail = query.data;

  return (
    <section className="space-y-3">
      <Header detail={detail} isPolling={isPolling} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <LinesPanel invoice={detail.invoice} />
          <PaymentsPanel invoice={detail.invoice} />
        </div>
        <div className="space-y-3">
          <CustomerPanel customer={detail.customer} />
          <DetailTotalsPanel invoice={detail.invoice} />
        </div>
      </div>
      <SriTimeline events={detail.sriEvents} />
      <ActionsBar
        detail={detail}
        onToast={showToast}
        onMutated={(next) => {
          if (next !== undefined) {
            queryClient.setQueryData(detailQueryKey(id), next);
          } else {
            void queryClient.invalidateQueries({ queryKey: detailQueryKey(id) });
          }
        }}
      />
      {toast !== null && (
        <div
          role={toast.variant === "error" ? "alert" : "status"}
          data-testid={`detail-toast-${toast.variant}`}
          className={
            toast.variant === "error"
              ? "rounded bg-rose-50 px-3 py-2 text-sm text-rose-900"
              : toast.variant === "success"
                ? "rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                : "rounded bg-slate-100 px-3 py-2 text-sm text-slate-800"
          }
        >
          {toast.message}
        </div>
      )}
    </section>
  );
}

export function InvoicesDetailPage(): ReactElement {
  const params = useParams();
  const id = params.id ?? "";
  return (
    <RequirePermission action="invoice.read">
      <InvoicesDetailInner id={id} />
    </RequirePermission>
  );
}
