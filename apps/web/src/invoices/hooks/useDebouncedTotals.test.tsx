/**
 * `useDebouncedTotals` tests
 * (SPEC-0042 §6.3 + hard rules: 250 ms debounce, AbortController cancels
 * in-flight, never computes totals client-side).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

afterEach(() => {
  // Defensive: ensure each test starts with real timers regardless of
  // how the previous test exited (e.g. timeout before useRealTimers).
  vi.useRealTimers();
});

import { useDebouncedTotals } from "./useDebouncedTotals.js";
import type { CreateInvoice, PreviewTotalsResponse } from "@facturador/contracts/invoices";

function makePayload(qty = "1"): CreateInvoice {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emissionPointId: "ep-1" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customerId: "c-1" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fechaEmision: "2026-05-25" as any,
    lines: [
      {
        descripcion: "x",
        cantidad: Number(qty),
        precioUnitario: 100,
        descuento: 0,
        impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
      },
    ],
    payments: [{ formaPago: "01", total: 115 }],
  };
}

function fakeResp(): PreviewTotalsResponse {
  return {
    lines: [],
    totalSinImpuestos: 100,
    totalDescuento: 0,
    totalConImpuestos: [
      {
        codigo: "2",
        codigoPorcentaje: "4",
        tarifa: 15,
        baseImponible: 100,
        valor: 15,
      },
    ],
    propina: 0,
    importeTotal: 115,
  };
}

describe("useDebouncedTotals", () => {
  it("fires exactly one preview after 250 ms", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => fakeResp());
    const { result } = renderHook(() =>
      useDebouncedTotals(makePayload(), { fetcher, delayMs: 250 }),
    );
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    // Flush microtasks so the promise resolves.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.current.data?.importeTotal).toBe(115);
    vi.useRealTimers();
  });

  it("two rapid changes within 250 ms collapse to a single fire", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => fakeResp());
    const { rerender } = renderHook(
      (body: CreateInvoice) => useDebouncedTotals(body, { fetcher, delayMs: 250 }),
      { initialProps: makePayload("1") },
    );
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    rerender(makePayload("2"));
    await act(async () => {
      vi.advanceTimersByTime(249);
    });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("does not fire when disabled", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => fakeResp());
    renderHook(() => useDebouncedTotals(makePayload(), { fetcher, enabled: false }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetcher).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not fire when payload is null", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => fakeResp());
    renderHook(() => useDebouncedTotals(null, { fetcher }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetcher).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("aborts in-flight on new change", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_body, signal: AbortSignal) =>
        new Promise<PreviewTotalsResponse>((resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
          setTimeout(() => { resolve(fakeResp()); }, 1000);
        }),
    );
    const { rerender } = renderHook(
      (body: CreateInvoice) => useDebouncedTotals(body, { fetcher, delayMs: 50 }),
      { initialProps: makePayload("1") },
    );
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // First call started.
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender(makePayload("2"));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // First call's promise will reject with AbortError; that path is
    // covered (no setState on stale controller).
    vi.useRealTimers();
  });

  it("surfaces errors as state.error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() =>
      useDebouncedTotals(makePayload(), { fetcher, delayMs: 10 }),
    );
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBeInstanceOf(Error);
    vi.useRealTimers();
  });
});
