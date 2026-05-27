/**
 * `useAutoSave` tests
 * (SPEC-0042 §FR-8 / TASKS-0042 §3.2 / hard rule: 30 s interval, collapse
 * duplicate fires, cancel on unmount + REVIEW-0044 §8 ETag conflict).
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api.js";

import { useAutoSave, type AutoSaveSaver } from "./useAutoSave.js";

function makeBody(): import("@facturador/contracts/invoices").UpdateInvoice {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customerId: "c-1" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fechaEmision: "2026-05-25" as any,
    lines: [
      {
        descripcion: "x",
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
      },
    ],
    payments: [{ formaPago: "01", total: 115 }],
  };
}

describe("useAutoSave", () => {
  it("does nothing when invoiceId is null", () => {
    vi.useFakeTimers();
    const saver = vi.fn();
    renderHook(() =>
      { useAutoSave({
        invoiceId: null,
        dirty: true,
        buildBody: () => makeBody(),
        saver: saver as unknown as AutoSaveSaver,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(saver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("fires after 30 s when dirty + id present", async () => {
    vi.useFakeTimers();
    const saver = vi.fn(async () => undefined);
    const onSaved = vi.fn();
    renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        saver: saver as unknown as AutoSaveSaver,
        onSaved,
      }); },
    );
    expect(saver).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    // Flush promise so onSaved fires.
    await act(async () => {
      await Promise.resolve();
    });
    expect(saver).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("collapses duplicate fires while in-flight", async () => {
    vi.useFakeTimers();
    let resolveFn: (() => void) | null = null;
    const saver = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFn = resolve;
        }),
    );
    renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        intervalMs: 1000,
        saver: saver as unknown as AutoSaveSaver,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saver).toHaveBeenCalledTimes(1);
    // While in-flight, next tick should NOT fire.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saver).toHaveBeenCalledTimes(1);
    // Resolve first call → next tick should fire.
    const resolve = resolveFn as (() => void) | null;
    resolve?.();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saver).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does nothing when dirty=false", () => {
    vi.useFakeTimers();
    const saver = vi.fn();
    renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: false,
        buildBody: () => makeBody(),
        saver: saver as unknown as AutoSaveSaver,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(saver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancels the interval on unmount", () => {
    vi.useFakeTimers();
    const saver = vi.fn(async () => undefined);
    const { unmount } = renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        saver: saver as unknown as AutoSaveSaver,
      }); },
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(saver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("aborts the in-flight request on unmount", () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | null = null;
    const saver: AutoSaveSaver = (_id, _body, { signal }) => {
      receivedSignal = signal;
      return new Promise(() => undefined);
    };
    const { unmount } = renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        intervalMs: 100,
        saver,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const captured = receivedSignal as AbortSignal | null;
    expect(captured).not.toBeNull();
    unmount();
    expect(captured === null ? false : captured.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("does NOT fire when buildBody returns null", () => {
    vi.useFakeTimers();
    const saver = vi.fn();
    renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => null,
        intervalMs: 100,
        saver: saver as unknown as AutoSaveSaver,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(saver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("invokes onError on save failure", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const saver = vi.fn(async () => {
      throw new Error("boom");
    });
    renderHook(() =>
      { useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        intervalMs: 100,
        saver: saver as unknown as AutoSaveSaver,
        onError,
      }); },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("forwards the current etag to the saver and adopts the next one", async () => {
    vi.useFakeTimers();
    const seenEtags: (string | null)[] = [];
    const saver = vi.fn(async (_id, _body, { etag }: { etag: string | null }) => {
      seenEtags.push(etag);
      return { etag: `etag-${seenEtags.length}` };
    });
    renderHook(() => {
      useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        intervalMs: 100,
        initialEtag: "etag-0",
        saver: saver as unknown as AutoSaveSaver,
      });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seenEtags[0]).toBe("etag-0");
    // Second tick should have picked up the etag returned by the first save.
    expect(seenEtags[1]).toBe("etag-1");
    vi.useRealTimers();
  });

  it("invokes onConflict (NOT onError) on 412 Precondition Failed", async () => {
    vi.useFakeTimers();
    const onConflict = vi.fn();
    const onError = vi.fn();
    const saver = vi.fn(async () => {
      throw new ApiError({
        type: "about:blank",
        title: "Precondition Failed",
        status: 412,
        code: "invoice.etag_mismatch",
      });
    });
    renderHook(() => {
      useAutoSave({
        invoiceId: "inv-1",
        dirty: true,
        buildBody: () => makeBody(),
        intervalMs: 100,
        saver: saver as unknown as AutoSaveSaver,
        onConflict,
        onError,
      });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onConflict).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
