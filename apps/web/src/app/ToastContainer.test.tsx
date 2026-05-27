/**
 * Tests for `<ToastContainer />` and the toast event bus (REVIEW-0044 §UX).
 *
 * Covers:
 *   - Emitting a toast event renders the toast.
 *   - The toast auto-dismisses after the default duration.
 *   - The toast carries `role="status"` for assistive tech announcement.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitToast } from "./toast-bus.js";
import { ToastContainer, DEFAULT_TOAST_DURATION_MS } from "./ToastContainer.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("<ToastContainer />", () => {
  it("renders nothing initially (live region exists but is empty)", () => {
    render(<ToastContainer />);
    const region = screen.getByTestId("toast-container");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("role", "status");
    expect(screen.queryByTestId(/^toast-(info|success|error)$/)).toBeNull();
  });

  it("emitToast → toast renders with the supplied message", () => {
    render(<ToastContainer />);
    act(() => {
      emitToast({ message: "Borrador guardado", variant: "success" });
    });
    const toast = screen.getByTestId("toast-success");
    expect(toast).toHaveTextContent("Borrador guardado");
  });

  it("auto-dismisses after DEFAULT_TOAST_DURATION_MS", () => {
    render(<ToastContainer />);
    act(() => {
      emitToast({ message: "Hola" });
    });
    expect(screen.getByTestId("toast-info")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS + 50);
    });
    expect(screen.queryByTestId("toast-info")).toBeNull();
  });

  it("a newer toast replaces a still-active older toast", () => {
    render(<ToastContainer />);
    act(() => {
      emitToast({ message: "Primero" });
    });
    expect(screen.getByTestId("toast-info")).toHaveTextContent("Primero");
    act(() => {
      emitToast({ message: "Segundo", variant: "error" });
    });
    expect(screen.queryByTestId("toast-info")).toBeNull();
    expect(screen.getByTestId("toast-error")).toHaveTextContent("Segundo");
  });
});
