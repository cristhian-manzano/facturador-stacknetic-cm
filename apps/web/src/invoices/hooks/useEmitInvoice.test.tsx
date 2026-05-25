/**
 * `useEmitInvoice` tests
 * (SPEC-0042 §FR-7 / TASKS-0042 §3.3 / CSRF header verified at apiFetch
 * layer — this test pins the wrapper's behaviour and CSRF presence via the
 * MSW-based integration test in invoice-form.test.tsx).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { mswServer } from "../../../test/msw/server.js";
import { useEmitInvoice } from "./useEmitInvoice.js";

describe("useEmitInvoice", () => {
  it("invokes the provided emitter and returns the response", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter: any = vi.fn(async () => ({
      estado: "AUTORIZADO" as const,
      claveAcceso: "1".repeat(49),
    }));
    const { result } = renderHook(() => useEmitInvoice({ emitter }));
    let out: unknown;
    await act(async () => {
      out = await result.current.emit("inv-1");
    });
    expect(emitter).toHaveBeenCalledOnce();
    expect(emitter.mock.calls[0]?.[0]).toBe("inv-1");
    expect((out as { estado: string }).estado).toBe("AUTORIZADO");
  });

  it("aborts the previous emit when a new one starts", async () => {
    let firstSignal: AbortSignal | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter: any = vi.fn(async (_id: string, signal?: AbortSignal) => {
      if (firstSignal === null) firstSignal = signal ?? null;
      return {
        estado: "AUTORIZADO" as const,
        claveAcceso: "1".repeat(49),
      };
    });
    const { result } = renderHook(() => useEmitInvoice({ emitter }));
    void result.current.emit("inv-1");
    await act(async () => {
      await result.current.emit("inv-2");
    });
    // TS narrows the closure-assigned ref to `never`; cast back at the
    // assertion site.
    const signal = firstSignal as AbortSignal | null;
    expect(signal === null ? false : signal.aborted).toBe(true);
  });

  it("real emit (no override) attaches the CSRF header on POST", async () => {
    // Seed the CSRF cookie that apiFetch reads.
    document.cookie = "facturador_csrf=fake-csrf-token; path=/";
    let observedCsrf: string | null = null;
    mswServer.use(
      http.post("/api/v1/invoices/:id/emit", ({ request }) => {
        observedCsrf = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({
          estado: "AUTORIZADO",
          claveAcceso: "1111111111111111111111111111111111111111111111114",
        });
      }),
    );
    const { result } = renderHook(() => useEmitInvoice());
    await act(async () => {
      await result.current.emit("01KS5R6NXR0MY0X8SFHAH0GYDD");
    });
    expect(observedCsrf).toBe("fake-csrf-token");
  });

  it("cancel() aborts the in-flight emit", async () => {
    let receivedSignal: AbortSignal | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter: any = vi.fn((_id: string, signal?: AbortSignal) => {
      return new Promise(() => {
        receivedSignal = signal ?? null;
      });
    });
    const { result } = renderHook(() => useEmitInvoice({ emitter }));
    void result.current.emit("inv-1");
    await act(async () => {
      await Promise.resolve();
    });
    result.current.cancel();
    const signal = receivedSignal as AbortSignal | null;
    expect(signal === null ? false : signal.aborted).toBe(true);
  });
});
