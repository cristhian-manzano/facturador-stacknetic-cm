/**
 * `<FiltersBar />` — filters for the invoice list (SPEC-0043 §FR-1).
 *
 * Hard rules pinned here:
 *   - Filter state is read FROM the URL via `useSearchParams` and written
 *     BACK to the URL on every change. The URL is the single source of
 *     truth so refresh / share-link preserves state.
 *   - Estado is a single-select multi-friendly chip row; we ship a
 *     simple `<select>` with one "Todos" option + the 3 enum values.
 *     Multi-select can be wired later without changing the URL contract
 *     (the API already accepts repeated `?estado=` per
 *     `apps/api/src/invoices/handlers.ts:81..86`).
 *   - Date inputs use `<input type="date">` which the browser locale
 *     formats into the user's display style; the underlying value is
 *     always `YYYY-MM-DD` per the API contract.
 *   - Free-text `q` field; debouncing handled by the parent's query key
 *     (every keystroke updates URL, which updates query — but
 *     TanStack Query's keyed dedupe + the server's natural rate-limits
 *     keep this fine for v1).
 *   - Changing any filter RESETS the cursor (otherwise the user's
 *     "Cargar más" would compound a wrong cursor onto a fresh filter
 *     set).
 *
 * Accessibility:
 *   - Every input is `<label htmlFor>` paired.
 *   - The "Limpiar filtros" button is hidden when no filter is set.
 */
import { useCallback, useMemo, type ChangeEvent, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

import { cn } from "../../lib/cn.js";
import { t } from "../../i18n/es.js";

type EstadoFilter = "" | "BORRADOR" | "EMITIDO" | "ANULADO";

const ESTADO_OPTIONS: readonly { readonly value: EstadoFilter; readonly labelKey: string }[] = [
  { value: "", labelKey: "invoice.list.filters.estado.all" },
  { value: "BORRADOR", labelKey: "invoice.estado.BORRADOR" },
  { value: "EMITIDO", labelKey: "invoice.estado.EMITIDO" },
  { value: "ANULADO", labelKey: "invoice.estado.ANULADO" },
] as const;

export function FiltersBar(): ReactElement {
  const [search, setSearch] = useSearchParams();

  const estado = (search.get("estado") ?? "") as EstadoFilter;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const q = search.get("q") ?? "";

  const hasAnyFilter = useMemo(
    () => estado !== "" || from !== "" || to !== "" || q !== "",
    [estado, from, to, q],
  );

  /**
   * Mutate one filter. We work off the CURRENT URL (not stale closure
   * values) by accepting a `prev` argument to `setSearch`.
   *
   * Changing any filter clears `cursor` — otherwise the next "Cargar
   * más" would jump from the wrong page.
   */
  const updateFilter = useCallback(
    (key: "estado" | "from" | "to" | "q", value: string) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === "") {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          // Filter changed → reset pagination.
          next.delete("cursor");
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  const onClear = useCallback(() => {
    setSearch(new URLSearchParams(), { replace: true });
  }, [setSearch]);

  const onEstadoChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    updateFilter("estado", e.target.value);
  };
  const onFromChange = (e: ChangeEvent<HTMLInputElement>): void => {
    updateFilter("from", e.target.value);
  };
  const onToChange = (e: ChangeEvent<HTMLInputElement>): void => {
    updateFilter("to", e.target.value);
  };
  const onQChange = (e: ChangeEvent<HTMLInputElement>): void => {
    updateFilter("q", e.target.value);
  };

  return (
    <div
      data-testid="filters-bar"
      className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3"
    >
      <div className="flex flex-col">
        <label htmlFor="filter-estado" className="text-xs font-medium text-slate-600">
          {t("invoice.list.filters.estado")}
        </label>
        <select
          id="filter-estado"
          data-testid="filter-estado"
          className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          value={estado}
          onChange={onEstadoChange}
        >
          {ESTADO_OPTIONS.map((opt) => (
            <option key={opt.value === "" ? "all" : opt.value} value={opt.value}>
              {t(opt.labelKey as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <label htmlFor="filter-from" className="text-xs font-medium text-slate-600">
          {t("invoice.list.filters.from")}
        </label>
        <input
          id="filter-from"
          data-testid="filter-from"
          type="date"
          className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          value={from}
          onChange={onFromChange}
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="filter-to" className="text-xs font-medium text-slate-600">
          {t("invoice.list.filters.to")}
        </label>
        <input
          id="filter-to"
          data-testid="filter-to"
          type="date"
          className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          value={to}
          onChange={onToChange}
        />
      </div>

      <div className="flex flex-1 flex-col">
        <label htmlFor="filter-q" className="text-xs font-medium text-slate-600">
          {t("invoice.list.filters.q")}
        </label>
        <input
          id="filter-q"
          data-testid="filter-q"
          type="search"
          autoComplete="off"
          placeholder={t("invoice.list.filters.q.placeholder")}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={q}
          onChange={onQChange}
        />
      </div>

      <button
        type="button"
        data-testid="filters-clear"
        onClick={onClear}
        className={cn(
          "rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50",
          !hasAnyFilter && "invisible",
        )}
        aria-hidden={!hasAnyFilter}
      >
        {t("invoice.list.filters.clear")}
      </button>
    </div>
  );
}
