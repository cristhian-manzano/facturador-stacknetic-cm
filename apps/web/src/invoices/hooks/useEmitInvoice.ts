/**
 * `useEmitInvoice` — mutation hook for `POST /api/v1/invoices/:id/emit`
 * (SPEC-0042 §FR-7 / SPEC-0033 / TASKS-0042 §3.3).
 *
 * The hook returns:
 *   - `emit(id)` — fires the request; resolves with the orchestrator
 *     response or rejects with the typed `ApiError`. The EmitModal owns
 *     the state machine; this hook only wraps the call.
 *
 * Why not TanStack Query's `useMutation`?
 *   - The EmitModal already runs a `useReducer` state machine; layering
 *     `useMutation` on top adds bookkeeping with no payoff. A thin
 *     wrapper around `emitInvoice` keeps the indirection low.
 */
import { useCallback, useRef } from "react";
import type { EmitInvoiceResponse } from "@facturador/contracts/invoices";

import { emitInvoice } from "../api.js";

export type EmitInvoiceFn = (id: string, signal?: AbortSignal) => Promise<EmitInvoiceResponse>;

export interface UseEmitInvoiceOptions {
  readonly emitter?: EmitInvoiceFn;
}

export interface UseEmitInvoiceResult {
  readonly emit: (id: string) => Promise<EmitInvoiceResponse>;
  /** Abort the in-flight emit, if any. Currently unused; left for future. */
  readonly cancel: () => void;
}

export function useEmitInvoice(options: UseEmitInvoiceOptions = {}): UseEmitInvoiceResult {
  const emitter = options.emitter ?? emitInvoice;
  const emitterRef = useRef(emitter);
  emitterRef.current = emitter;
  const controllerRef = useRef<AbortController | null>(null);

  const emit = useCallback(async (id: string): Promise<EmitInvoiceResponse> => {
    if (controllerRef.current !== null) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      return await emitterRef.current(id, controller.signal);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback((): void => {
    if (controllerRef.current !== null) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  return { emit, cancel };
}
