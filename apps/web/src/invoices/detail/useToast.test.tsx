/**
 * Tests for `useToast` (detail-page scope).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useToast } from "./useToast.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useToast", () => {
  it("starts with no toast", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it("show() sets a toast then auto-dismisses after the duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => { result.current.show("hi"); });
    expect(result.current.toast).toEqual({ message: "hi", variant: "info" });
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.toast).toBeNull();
  });

  it("dismiss() clears immediately", () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.show("hi", "success", 9999); });
    expect(result.current.toast).not.toBeNull();
    act(() => { result.current.dismiss(); });
    expect(result.current.toast).toBeNull();
  });

  it("the second show() replaces the first and resets the timer", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => { result.current.show("first"); });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => { result.current.show("second", "error"); });
    expect(result.current.toast).toEqual({
      message: "second",
      variant: "error",
    });
    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toast).toBeNull();
  });
});
