/**
 * `CustomerCombobox` — async-search combobox + "Nuevo cliente" button
 * (SPEC-0042 §FR-3 / TASKS-0042 §2.5).
 *
 * Behaviour:
 *   - Types ≥ 2 chars → debounced GET /api/v1/customers?q= after 250 ms.
 *   - Each new keystroke cancels the in-flight request via AbortController.
 *   - Selecting an item sets `customerId` in the form.
 *   - "Nuevo cliente" button surfaces the dialog; on create the new
 *     customer is selected.
 *
 * Accessibility:
 *   - The input is a `role="combobox"` with `aria-controls` pointing at
 *     the listbox. Selected option is `aria-selected="true"`.
 *   - Arrow keys move highlight; Enter selects; Esc closes.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { searchCustomers, type CustomerListItem } from "../api.js";
import { ApiError } from "../../lib/api.js";
import { t } from "../../i18n/es.js";

export interface CustomerComboboxProps {
  /** Currently-selected customer id (or empty string). */
  readonly value: string;
  /** Display label rendered in the input when a customer is selected. */
  readonly selectedLabel: string;
  readonly onSelect: (customer: CustomerListItem) => void;
  readonly onCreateNewRequested: () => void;
  /** Test seam: override the search function. */
  readonly searcher?: typeof searchCustomers;
  readonly debounceMs?: number;
}

const MIN_QUERY = 2;

export function CustomerCombobox({
  value,
  selectedLabel,
  onSelect,
  onCreateNewRequested,
  searcher,
  debounceMs = 250,
}: CustomerComboboxProps): ReactElement {
  const inputId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>(selectedLabel);
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  // Reset display when the form's selected value changes externally.
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  // Outside-click + Esc closing.
  useEffect(() => {
    function onDocClick(ev: MouseEvent): void {
      if (rootRef.current === null) return;
      if (!(ev.target instanceof Node)) return;
      if (!rootRef.current.contains(ev.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return (): void => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (controllerRef.current !== null) controllerRef.current.abort();
    };
  }, []);

  // Debounced fetch on query change.
  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (controllerRef.current !== null) controllerRef.current.abort();
    setError(null);
    if (query.trim().length < MIN_QUERY) {
      setItems([]);
      setIsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const search = searcher ?? searchCustomers;
      search(query.trim(), { signal: controller.signal, limit: 10 })
        .then((resp) => {
          if (!mountedRef.current) return;
          if (controllerRef.current !== controller) return;
          setItems(resp.items);
          setIsLoading(false);
          setHighlighted(0);
        })
        .catch((err: unknown) => {
          const name = (err as { name?: string }).name;
          if (name === "AbortError") return;
          if (!mountedRef.current) return;
          if (controllerRef.current !== controller) return;
          setIsLoading(false);
          setItems([]);
          setError(err instanceof ApiError ? err.problem.title : "Error");
        });
    }, debounceMs);
    return (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [query, debounceMs, searcher]);

  const pickIndex = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (item === undefined) return;
      onSelect(item);
      setOpen(false);
      setQuery(item.razonSocial);
    },
    [items, onSelect],
  );

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(items.length - 1, h + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (ev.key === "Enter") {
      if (open && items.length > 0) {
        ev.preventDefault();
        pickIndex(highlighted);
      }
    } else if (ev.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {t("invoice.form.customer")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          data-testid="customer-search-input"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("invoice.form.customer.search")}
          value={query}
          onChange={(ev) => {
            setQuery(ev.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-invalid={value === "" ? "true" : "false"}
        />
        <button
          type="button"
          onClick={onCreateNewRequested}
          className="rounded border border-primary-600 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50"
        >
          {t("invoice.form.customer.new")}
        </button>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("invoice.form.customer")}
          data-testid="customer-listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-200 bg-white shadow-lg"
        >
          {isLoading && (
            <li role="status" aria-live="polite" className="px-3 py-2 text-xs text-slate-500">
              Buscando…
            </li>
          )}
          {!isLoading && error !== null && (
            <li role="alert" className="px-3 py-2 text-xs text-red-700">
              {error}
            </li>
          )}
          {!isLoading && error === null && query.trim().length < MIN_QUERY && (
            <li className="px-3 py-2 text-xs text-slate-500">
              {t("invoice.form.customer.search")}
            </li>
          )}
          {!isLoading &&
            error === null &&
            items.length === 0 &&
            query.trim().length >= MIN_QUERY && (
              <li className="px-3 py-2 text-xs text-slate-500">Sin resultados</li>
            )}
          {items.map((item, idx) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={idx === highlighted}
                data-testid={`customer-option-${item.id}`}
                onMouseEnter={() => setHighlighted(idx)}
                onMouseDown={(ev) => {
                  // mouseDown so blur doesn't fire first
                  ev.preventDefault();
                  pickIndex(idx);
                }}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  idx === highlighted ? "bg-primary-50" : ""
                }`}
              >
                <span className="font-medium text-slate-900">{item.razonSocial}</span>
                <span className="block text-xs text-slate-500">
                  {item.tipoIdentificacion} · {item.identificacion}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
