/**
 * `<PendingBanner />` — aggregates the count of "pending" invoices on
 * the current page and offers a one-click "Refrescar todas" that fans
 * out per-row `POST /:id/refresh` calls with a small concurrency cap
 * (SPEC-0043 §13 + TASKS-0043 §1.4).
 *
 * "Pending" definition (matches the polling-eligible set):
 *
 *   sriEstado ∈ { EN_PROCESO, RECIBIDA, ERROR_RED }
 *
 * Note ENVIADO is intentionally NOT considered pending — the SRI's
 * recepción acknowledged but autorización is being awaited; this is
 * the same state we'd otherwise classify as "in transit". For v1 we
 * only count the three estados that the detail-page poll handles so
 * the banner count matches the user's mental model.
 *
 * Concurrency: a tiny pool of 3 in-flight requests at a time. Pure
 * helper `runWithConcurrency` exposed for the unit test.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { InvoiceListItem } from "@facturador/contracts/invoices";

import { isPollableEstado } from "../detail/polling.js";
import { refreshInvoice } from "../api.js";
import { t } from "../../i18n/es.js";

/**
 * Run `tasks` with at most `concurrency` running in parallel. Resolves
 * when all settle. Errors are caught per-task and forwarded to
 * `onError`; the pool itself NEVER rejects so a single failure can't
 * starve the others.
 *
 * Pure: takes the task functions and the concurrency as inputs;
 * exposed for the unit test to assert the in-flight count never
 * exceeds the cap.
 */
export async function runWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
  onError?: (err: unknown, index: number) => void,
): Promise<void> {
  if (concurrency < 1) throw new Error("concurrency must be ≥ 1");
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      try {
        // Cast: tasks is read-only, but we know idx is valid by the bound check.
        const task = tasks[idx];
        if (task === undefined) return;
        await task();
      } catch (err) {
        onError?.(err, idx);
      }
    }
  }
  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, tasks.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
}

export const PENDING_REFRESH_CONCURRENCY = 3;

export interface PendingBannerProps {
  readonly items: readonly InvoiceListItem[];
  /** Called when the batch finishes (success or per-row error). */
  readonly onBatchDone?: () => void;
  /** Test seam: replace `refreshInvoice` with a stub. */
  readonly refreshFn?: (id: string) => Promise<unknown>;
}

export function PendingBanner({
  items,
  onBatchDone,
  refreshFn,
}: PendingBannerProps): ReactElement | null {
  const pending = useMemo(() => items.filter((it) => isPollableEstado(it.sriEstado)), [items]);
  const [running, setRunning] = useState(false);

  const onRefreshAll = useCallback(async () => {
    if (pending.length === 0) return;
    if (running) return;
    setRunning(true);
    const fn = refreshFn ?? ((id: string) => refreshInvoice(id));
    const tasks = pending.map((row) => () => fn(row.id));
    try {
      await runWithConcurrency(tasks, PENDING_REFRESH_CONCURRENCY);
    } finally {
      setRunning(false);
      onBatchDone?.();
    }
  }, [pending, running, refreshFn, onBatchDone]);

  if (pending.length === 0) return null;

  const message =
    pending.length === 1
      ? t("invoice.list.pendingBanner.one")
      : t("invoice.list.pendingBanner", { count: pending.length });

  return (
    <div
      data-testid="pending-banner"
      role="status"
      className="flex items-center justify-between gap-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
    >
      <span data-testid="pending-banner-message">{message}</span>
      <button
        type="button"
        data-testid="pending-banner-refresh"
        onClick={() => void onRefreshAll()}
        disabled={running}
        className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running
          ? t("invoice.list.pendingBanner.refreshing")
          : t("invoice.list.pendingBanner.refreshAll")}
      </button>
    </div>
  );
}
