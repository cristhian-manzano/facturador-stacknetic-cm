/**
 * `useDebouncedTotals` — drives the live totals panel
 * (SPEC-0042 §FR-5 / §6.3 / PLAN-0042 §4 Phase 3).
 *
 * Contract:
 *   - Caller passes the current `CreateInvoice` payload (already
 *     RHF-validated by the caller; the hook does not re-validate).
 *   - Hook debounces by `delayMs` (default 250 ms; matches SPEC).
 *   - Hook keeps an `AbortController` for the in-flight request and
 *     cancels it whenever a new debounced fire is scheduled.
 *   - Returns `{ data, isPending, error }` so the totals panel can show
 *     a spinner without blocking input.
 *
 * Why not TanStack Query's `useQuery`? Two reasons:
 *   1. We want the AbortController behaviour AND the debounce together,
 *      which `useQuery` doesn't model out of the box.
 *   2. The hook is a single side-effect tied to the form state; we don't
 *      need cache keys, retries, or stale-while-revalidate.
 *
 * Hard rules honoured here:
 *   - The hook NEVER computes totals locally; every render of the totals
 *     panel uses `data` from the API.
 *   - When `enabled === false` (e.g. lines empty), the hook does NOT
 *     fire the request and returns the last successful result.
 *   - Cleanup on unmount cancels the in-flight request.
 */
import { useEffect, useRef, useState } from "react";

import type { CreateInvoice, PreviewTotalsResponse } from "@facturador/contracts/invoices";

import { ApiError } from "../../lib/api.js";
import { previewInvoiceTotals } from "../api.js";

export interface UseDebouncedTotalsOptions {
  readonly delayMs?: number;
  /**
   * When `false`, the hook stays idle (no fetch). Used to skip the call
   * while the form is invalid (e.g. missing emissionPointId or empty
   * lines) — the API would 400 anyway, and a 400 is just noise here.
   */
  readonly enabled?: boolean;
  /**
   * Optional override for the fetch helper. Tests pass in a recording stub
   * to assert call counts without going through MSW.
   */
  readonly fetcher?: (body: CreateInvoice, signal: AbortSignal) => Promise<PreviewTotalsResponse>;
}

export interface UseDebouncedTotalsResult {
  readonly data: PreviewTotalsResponse | null;
  readonly isPending: boolean;
  readonly error: Error | null;
}

const EMPTY: UseDebouncedTotalsResult = {
  data: null,
  isPending: false,
  error: null,
};

/**
 * `payloadKey` — stable JSON serialization used as the debounce/dedup
 * key. RHF's `useWatch` returns a new object reference on every render
 * even when nothing changed; comparing JSON keeps the hook from firing
 * spurious requests.
 */
function payloadKey(body: CreateInvoice): string {
  try {
    return JSON.stringify(body);
  } catch {
    // Cyclic / non-serialisable — extremely unlikely with form data, but
    // fall back to a random key so we never crash the hook.
    return `${Date.now()}_${Math.random()}`;
  }
}

export function useDebouncedTotals(
  body: CreateInvoice | null,
  options: UseDebouncedTotalsOptions = {},
): UseDebouncedTotalsResult {
  const { delayMs = 250, enabled = true, fetcher } = options;
  const [state, setState] = useState<UseDebouncedTotalsResult>(EMPTY);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (controllerRef.current !== null) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled || body === null) return undefined;
    const key = payloadKey(body);
    if (key === lastKeyRef.current) return undefined;

    // Schedule the debounced fire. Clear any pending timer + cancel the
    // in-flight request — we always want the LATEST snapshot to win.
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (controllerRef.current !== null) controllerRef.current.abort();

    const controller = new AbortController();
    controllerRef.current = controller;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastKeyRef.current = key;
      if (mountedRef.current) {
        setState((prev) => ({ data: prev.data, isPending: true, error: null }));
      }
      const call = fetcher ?? previewInvoiceTotals;
      call(body, controller.signal)
        .then((data) => {
          // Drop the result if a newer call superseded this one.
          if (!mountedRef.current) return;
          if (controllerRef.current !== controller) return;
          setState({ data, isPending: false, error: null });
        })
        .catch((err: unknown) => {
          // AbortError → ignore. The next fire will replace state.
          const name = (err as { name?: string }).name;
          if (name === "AbortError") return;
          if (!mountedRef.current) return;
          if (controllerRef.current !== controller) return;
          const wrapped =
            err instanceof Error
              ? err
              : new ApiError({
                  type: "about:blank",
                  title: "preview-totals failed",
                  status: 0,
                  code: "preview.unexpected",
                });
          setState((prev) => ({
            data: prev.data,
            isPending: false,
            error: wrapped,
          }));
        });
    }, delayMs);

    return (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [body, delayMs, enabled, fetcher]);

  return state;
}
