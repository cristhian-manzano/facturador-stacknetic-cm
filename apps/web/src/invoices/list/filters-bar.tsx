/**
 * `<FiltersBar />` — filters for the invoice list (SPEC-0043 §FR-1).
 *
 * Hard rules pinned here:
 *   - Filter state is read FROM the URL via `useSearchParams` and written
 *     BACK to the URL on every change. The URL is the single source of
 *     truth so refresh / share-link preserves state.
 *   - Estado is a MULTI-select chip row (REVIEW-0044). Each estado is a
 *     toggleable chip. The URL stores them as a comma-separated list in
 *     a single `?estado=` param so it stays compact and the API parser
 *     (which already accepts comma OR repeated values) understands either
 *     shape. We canonicalise on the comma form.
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
 *   - Estado chips are `<button role="checkbox" aria-checked>` so screen
 *     readers describe the toggle state.
 *   - The "Limpiar filtros" button is hidden when no filter is set.
 */
import { useCallback, useMemo, type ChangeEvent, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

import { t } from "../../i18n/es.js";
import { cn } from "../../lib/cn.js";

type EstadoValue = "BORRADOR" | "EMITIDO" | "ANULADO";

const ESTADO_CHIPS: readonly { readonly value: EstadoValue; readonly labelKey: string }[] = [
  { value: "BORRADOR", labelKey: "invoice.estado.BORRADOR" },
  { value: "EMITIDO", labelKey: "invoice.estado.EMITIDO" },
  { value: "ANULADO", labelKey: "invoice.estado.ANULADO" },
] as const;

/**
 * Parse the URL estado param into a typed set. Accepts both repeated
 * (`?estado=A&estado=B`) and comma-separated (`?estado=A,B`) forms — the
 * API handler accepts either, and historical URLs used the repeated form.
 *
 * Exported for unit tests.
 */
export function parseEstadoFromSearch(search: URLSearchParams): readonly EstadoValue[] {
  // Prefer comma-form when a single param contains a comma.
  const raw = search.getAll("estado").flatMap((v) => v.split(","));
  const valid = raw
    .map((v) => v.trim())
    .filter((v): v is EstadoValue => v === "BORRADOR" || v === "EMITIDO" || v === "ANULADO");
  // De-duplicate while preserving first-seen order so the URL canonicalises
  // predictably as the user toggles chips.
  const seen = new Set<EstadoValue>();
  const out: EstadoValue[] = [];
  for (const v of valid) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function FiltersBar(): ReactElement {
  const [search, setSearch] = useSearchParams();

  const selectedEstados = useMemo(() => parseEstadoFromSearch(search), [search]);
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const q = search.get("q") ?? "";

  const hasAnyFilter = useMemo(
    () => selectedEstados.length > 0 || from !== "" || to !== "" || q !== "",
    [selectedEstados, from, to, q],
  );

  /**
   * Mutate one simple filter (text / date). We work off the CURRENT URL
   * (not stale closure values) by accepting a `prev` argument to
   * `setSearch`.
   *
   * Changing any filter clears `cursor` — otherwise the next "Cargar
   * más" would jump from the wrong page.
   */
  const updateFilter = useCallback(
    (key: "from" | "to" | "q", value: string) => {
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

  const toggleEstado = useCallback(
    (estado: EstadoValue) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = parseEstadoFromSearch(prev);
          const has = current.includes(estado);
          const updated = has ? current.filter((e) => e !== estado) : [...current, estado];
          next.delete("estado");
          if (updated.length > 0) {
            // Canonical form: a single comma-separated param. Keeps the
            // URL short when many estados are selected, and the API
            // handler already accepts it.
            next.set("estado", updated.join(","));
          }
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
      <fieldset className="flex flex-col" data-testid="filter-estado-group">
        <legend className="text-xs font-medium text-slate-600">
          {t("invoice.list.filters.estado")}
        </legend>
        <div role="group" aria-label={t("invoice.list.filters.estado")} className="mt-1 flex gap-1">
          {ESTADO_CHIPS.map((chip) => {
            const isSelected = selectedEstados.includes(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                data-testid={`filter-estado-${chip.value}`}
                data-selected={isSelected ? "true" : "false"}
                onClick={() => {
                  toggleEstado(chip.value);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  isSelected
                    ? "border-primary-300 bg-primary-50 text-primary-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {t(chip.labelKey as Parameters<typeof t>[0])}
              </button>
            );
          })}
        </div>
      </fieldset>

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
