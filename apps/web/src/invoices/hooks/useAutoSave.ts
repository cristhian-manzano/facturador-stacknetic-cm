/**
 * `useAutoSave` — silent PATCH every 30 s while the form is dirty
 * (SPEC-0042 §FR-8 / PLAN-0042 §4 Phase 3 / TASKS-0042 §3.2).
 *
 * Contract:
 *   - Hook accepts the invoice `id` (null while the draft hasn't been
 *     created yet — auto-save is a no-op in that case), a `dirty` flag,
 *     and a payload-builder closure so callers don't have to lift the
 *     PATCH body up into render.
 *   - Hook fires every `intervalMs` (default 30 000 ms) IF `dirty` is
 *     true AND no save is currently in flight. Duplicate fires within
 *     the same 30 s window collapse (we never enqueue more than one).
 *   - On success: invokes `onSaved` (the form shows the "Borrador
 *     guardado" indicator).
 *   - On unmount: clears the timer + aborts any in-flight request.
 *   - On error: invokes `onError` (the form may surface a subtle hint;
 *     the user data is NOT discarded).
 */
import { useEffect, useRef } from "react";
import type { UpdateInvoice } from "@facturador/contracts/invoices";

import { updateInvoiceDraft } from "../api.js";

export type AutoSaveSaver = (
  id: string,
  body: UpdateInvoice,
  signal: AbortSignal,
) => Promise<unknown>;

export interface UseAutoSaveOptions {
  readonly invoiceId: string | null;
  readonly dirty: boolean;
  /**
   * Called by the interval to build the PATCH body from the current form
   * state. Returns `null` when nothing should be saved (e.g. the form is
   * partially valid but the dirty flag is misleading).
   */
  readonly buildBody: () => UpdateInvoice | null;
  readonly intervalMs?: number;
  readonly onSaved?: () => void;
  readonly onError?: (error: unknown) => void;
  /**
   * Test seam — defaults to `updateInvoiceDraft`. Tests substitute a
   * recorder so they don't need MSW for the auto-save assertion.
   */
  readonly saver?: AutoSaveSaver;
}

export function useAutoSave(options: UseAutoSaveOptions): void {
  const { invoiceId, dirty, buildBody, intervalMs = 30_000, onSaved, onError, saver } = options;

  // Refs hold the latest closures so the interval callback can read them
  // without resubscribing every render.
  const buildBodyRef = useRef(buildBody);
  buildBodyRef.current = buildBody;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const saverRef = useRef<AutoSaveSaver>(saver ?? updateInvoiceDraft);
  saverRef.current = saver ?? updateInvoiceDraft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const invoiceIdRef = useRef(invoiceId);
  invoiceIdRef.current = invoiceId;

  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (invoiceId === null) return undefined;

    const tick = (): void => {
      // Collapse duplicate fires when a save is already in flight.
      if (inFlightRef.current !== null) return;
      if (!dirtyRef.current) return;
      const id = invoiceIdRef.current;
      if (id === null) return;
      const body = buildBodyRef.current();
      if (body === null) return;
      const controller = new AbortController();
      inFlightRef.current = controller;
      void saverRef
        .current(id, body, controller.signal)
        .then(() => {
          if (inFlightRef.current !== controller) return;
          inFlightRef.current = null;
          onSavedRef.current?.();
        })
        .catch((err: unknown) => {
          if (inFlightRef.current !== controller) return;
          inFlightRef.current = null;
          const name = (err as { name?: string }).name;
          if (name === "AbortError") return;
          onErrorRef.current?.(err);
        });
    };

    const handle = setInterval(tick, intervalMs);
    return (): void => {
      clearInterval(handle);
      if (inFlightRef.current !== null) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
    // `invoiceId` and `intervalMs` define the timer lifecycle; everything
    // else is read from refs.
  }, [invoiceId, intervalMs]);
}
