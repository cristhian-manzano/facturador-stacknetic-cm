/**
 * `useAutoSave` — silent PATCH every 30 s while the form is dirty
 * (SPEC-0042 §FR-8 / PLAN-0042 §4 Phase 3 / TASKS-0042 §3.2 +
 * REVIEW-0044 §8 ETag conflict detection).
 *
 * Contract:
 *   - Hook accepts the invoice `id` (null while the draft hasn't been
 *     created yet — auto-save is a no-op in that case), a `dirty` flag,
 *     and a payload-builder closure so callers don't have to lift the
 *     PATCH body up into render.
 *   - Hook fires every `intervalMs` (default 30 000 ms) IF `dirty` is
 *     true AND no save is currently in flight. Duplicate fires within
 *     the same 30 s window collapse (we never enqueue more than one).
 *   - On success: invokes `onSaved(nextEtag)` with the new ETag (from
 *     the response). The hook tracks the latest ETag internally so the
 *     next PATCH can send `If-Match: <etag>`.
 *   - On 412 Precondition Failed (another tab edited the draft):
 *     invokes `onConflict()` so the form can surface
 *     "Otra pestaña actualizó este borrador. Recarga la página."
 *   - On unmount: clears the timer + aborts any in-flight request.
 *   - On any OTHER error: invokes `onError`.
 */
import { useEffect, useRef } from "react";

import type { UpdateInvoice } from "@facturador/contracts/invoices";

import { ApiError } from "../../lib/api.js";
import { updateInvoiceDraft } from "../api.js";

export interface AutoSaveSaverResult {
  /** ETag echoed by the server response (the `updatedAt` ISO string). */
  readonly etag?: string;
}

export type AutoSaveSaver = (
  id: string,
  body: UpdateInvoice,
  options: { readonly signal: AbortSignal; readonly etag: string | null },
) => Promise<AutoSaveSaverResult>;

export interface UseAutoSaveOptions {
  readonly invoiceId: string | null;
  readonly dirty: boolean;
  /**
   * Called by the interval to build the PATCH body from the current form
   * state. Returns `null` when nothing should be saved (e.g. the form is
   * partially valid but the dirty flag is misleading).
   */
  readonly buildBody: () => UpdateInvoice | null;
  /**
   * Initial ETag if the form opened with a server-loaded draft. The hook
   * tracks the latest etag internally; callers only need to pass the
   * starting value (or `null` for a fresh draft).
   */
  readonly initialEtag?: string | null;
  readonly intervalMs?: number;
  readonly onSaved?: (next: { readonly etag: string | null }) => void;
  /** 412 from the server — another tab beat us to it. */
  readonly onConflict?: () => void;
  readonly onError?: (error: unknown) => void;
  /**
   * Test seam — defaults to a saver that wraps `updateInvoiceDraft` and
   * reads/writes the `If-Match` header.
   */
  readonly saver?: AutoSaveSaver;
}

/**
 * Default saver: wraps `updateInvoiceDraft` to attach an `If-Match`
 * header when an etag is known. Surfaces 412 as a typed `ApiError` so
 * the hook can branch on `.status === 412`.
 */
const defaultSaver: AutoSaveSaver = async (id, body, { signal, etag: _etag }) => {
  // TODO(api): when apps/api adds `PATCH /invoices/:id` ETag support
  // (REVIEW-0044 §8, server side), the `_etag` arg will be plumbed
  // into an `If-Match` header here. Until then it's intentionally
  // ignored by the default saver — the hook still TRACKS the etag and
  // surfaces 412 to the conflict handler when the server is upgraded.
  // The server's `updatedAt` ISO string IS the canonical etag.
  const result = await updateInvoiceDraft(id, body, signal);
  // The server returns the full Invoice row; we adopt its `updatedAt` as
  // the next etag.
  const nextEtag =
    typeof (result as { updatedAt?: unknown }).updatedAt === "string"
      ? ((result as { updatedAt: string }).updatedAt)
      : undefined;
  return nextEtag !== undefined ? { etag: nextEtag } : {};
};

function extractEtag(result: unknown): string | null {
  if (
    result !== null &&
    typeof result === "object" &&
    "etag" in result &&
    typeof (result as { etag?: unknown }).etag === "string"
  ) {
    return (result as { etag: string }).etag;
  }
  return null;
}

export function useAutoSave(options: UseAutoSaveOptions): void {
  const {
    invoiceId,
    dirty,
    buildBody,
    initialEtag = null,
    intervalMs = 30_000,
    onSaved,
    onConflict,
    onError,
    saver,
  } = options;

  // Refs hold the latest closures so the interval callback can read them
  // without resubscribing every render.
  const buildBodyRef = useRef(buildBody);
  buildBodyRef.current = buildBody;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const saverRef = useRef<AutoSaveSaver>(saver ?? defaultSaver);
  saverRef.current = saver ?? defaultSaver;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const invoiceIdRef = useRef(invoiceId);
  invoiceIdRef.current = invoiceId;
  // Track the latest etag inside the hook so the next save attaches it.
  const etagRef = useRef<string | null>(initialEtag);

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
        .current(id, body, { signal: controller.signal, etag: etagRef.current })
        .then((result) => {
          if (inFlightRef.current !== controller) return;
          inFlightRef.current = null;
          const nextEtag = extractEtag(result);
          if (nextEtag !== null) {
            etagRef.current = nextEtag;
          }
          onSavedRef.current?.({ etag: nextEtag });
        })
        .catch((err: unknown) => {
          if (inFlightRef.current !== controller) return;
          inFlightRef.current = null;
          const name = (err as { name?: string }).name;
          if (name === "AbortError") return;
          // 412 Precondition Failed → ETag mismatch → another tab beat us.
          if (err instanceof ApiError && err.status === 412) {
            onConflictRef.current?.();
            return;
          }
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
