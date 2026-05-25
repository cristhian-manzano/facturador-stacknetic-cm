/**
 * `/invoices` route — filterable, cursor-paginated invoice list
 * (SPEC-0043 §FR-1 + TASKS-0043 §1).
 *
 * Behaviour:
 *   - Wrapped in `<RequirePermission action="invoice.read">`.
 *   - Reads filters (`estado`, `from`, `to`, `q`, `cursor`) from URL.
 *   - Calls `listInvoices({ … })` via TanStack Query.
 *   - "Cargar más" button appends the next page when `nextCursor` is
 *     non-null. Implemented as `useInfiniteQuery` so each page becomes
 *     its own request (cache shape stays simple).
 *   - "Refrescar" button invalidates the query.
 *   - `<EmptyState />` when no items at all.
 *   - `<PendingBanner />` aggregates the pending count across all
 *     pages loaded so far.
 *
 * Hard rules:
 *   - URL is the single source of truth for filter state.
 *   - Filter changes RESET the cursor (handled by FiltersBar).
 *   - Never poll the list page; only the detail page polls.
 */
import { useCallback, useMemo, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { InvoiceListItem, InvoiceListResponse } from "@facturador/contracts/invoices";

import { RequirePermission } from "../auth/RequirePermission.js";
import { useAuth } from "../auth/context.js";
import { ApiError } from "../lib/api.js";
import { t } from "../i18n/es.js";
import {
  buildInvoiceListSearchParams,
  listInvoices,
  type InvoiceListFilters,
} from "../invoices/api.js";
import { EmptyState } from "../invoices/list/empty-state.js";
import { FiltersBar } from "../invoices/list/filters-bar.js";
import { InvoicesTable } from "../invoices/list/invoices-table.js";
import { PendingBanner } from "../invoices/list/pending-banner.js";

/**
 * Read filters from the URL `URLSearchParams`. Pure: exported for the
 * unit test.
 */
export function filtersFromSearchParams(search: URLSearchParams): InvoiceListFilters {
  const out: {
    estado?: ("BORRADOR" | "EMITIDO" | "ANULADO")[];
    from?: string;
    to?: string;
    q?: string;
  } = {};
  const estado = search.getAll("estado");
  if (estado.length > 0) {
    const valid = estado.filter(
      (e): e is "BORRADOR" | "EMITIDO" | "ANULADO" =>
        e === "BORRADOR" || e === "EMITIDO" || e === "ANULADO",
    );
    if (valid.length > 0) out.estado = valid;
  }
  const from = search.get("from");
  if (from !== null && from !== "") out.from = from;
  const to = search.get("to");
  if (to !== null && to !== "") out.to = to;
  const q = search.get("q");
  if (q !== null && q !== "") out.q = q;
  return out;
}

/**
 * Stable query key for the list. We strip `cursor` (it's per-page,
 * baked into the infinite-query page param). The key still reflects
 * the active filters so cache miss happens on filter change.
 */
function buildListQueryKey(filters: InvoiceListFilters): QueryKey {
  // We serialise as a deterministic search string so two equivalent
  // filter sets hash identically.
  const stable = buildInvoiceListSearchParams(filters).toString();
  return ["invoices", "list", stable];
}

function InvoicesListInner(): ReactElement {
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canCreate = permissions.includes("invoice.create");

  const filters = useMemo(() => filtersFromSearchParams(search), [search]);

  const queryKey = useMemo(() => buildListQueryKey(filters), [filters]);

  const query = useInfiniteQuery<InvoiceListResponse>({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const cursor = typeof pageParam === "string" ? pageParam : undefined;
      const merged: InvoiceListFilters = cursor !== undefined ? { ...filters, cursor } : filters;
      return listInvoices(merged, signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Lists never poll. The user clicks Refrescar or filter-changes.
    refetchOnWindowFocus: false,
  });

  const items: readonly InvoiceListItem[] = useMemo(() => {
    if (query.data === undefined) return [];
    return query.data.pages.flatMap((p) => p.items);
  }, [query.data]);

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
  }, [queryClient]);

  // Show the empty state ONLY when:
  //   1. The query has resolved.
  //   2. No filters are active (otherwise show the filtered-empty table).
  //   3. The first page is empty.
  const noFilters = Object.keys(filters).length === 0;
  const isInitialEmpty = query.status === "success" && noFilters && items.length === 0;

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t("invoice.list.title")}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="list-refresh"
            onClick={onRefresh}
            disabled={query.isFetching}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("invoice.list.refresh")}
          </button>
          {canCreate && (
            <Link
              to="/invoices/new"
              data-testid="list-create"
              className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t("invoice.list.create")}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <FiltersBar />

        {query.status === "pending" && (
          <p
            role="status"
            aria-live="polite"
            data-testid="list-loading"
            className="text-sm text-slate-600"
          >
            {t("invoice.list.loading")}
          </p>
        )}

        {query.status === "error" && (
          <div
            role="alert"
            data-testid="list-error"
            className="space-y-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
          >
            <p className="font-semibold">{t("invoice.list.error.title")}</p>
            <p>
              {query.error instanceof ApiError ? query.error.problem.title : query.error.message}
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              {t("invoice.list.error.retry")}
            </button>
          </div>
        )}

        {query.status === "success" && (
          <>
            <PendingBanner
              items={items}
              onBatchDone={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["invoices", "list"],
                });
              }}
            />
            {isInitialEmpty ? (
              <EmptyState />
            ) : (
              <>
                <InvoicesTable items={items} />
                {query.hasNextPage && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      data-testid="list-load-more"
                      onClick={() => void query.fetchNextPage()}
                      disabled={query.isFetchingNextPage}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("invoice.list.loadMore")}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function InvoicesIndexPage(): ReactElement {
  return (
    <RequirePermission action="invoice.read">
      <InvoicesListInner />
    </RequirePermission>
  );
}
