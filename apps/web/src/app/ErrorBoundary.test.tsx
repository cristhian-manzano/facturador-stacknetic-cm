/**
 * Tests for `<ErrorBoundary />` (REVIEW-0044 §UX).
 *
 * Covers:
 *   - Render error in a child → fallback renders.
 *   - Fallback shows the "Algo salió mal" heading and a "Recargar" button.
 *   - The reload button is keyboard-focusable and invokes the test seam.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary.js";

function Boom(): never {
  throw new Error("render failure");
}

describe("<ErrorBoundary />", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <p data-testid="happy">hello</p>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("happy")).toBeInTheDocument();
  });

  it("renders the fallback when a child throws during render", () => {
    // Vitest's jsdom logs the error twice (React's internal noise). We
    // silence the spy to keep the test output clean. The boundary catches
    // the error and renders the fallback.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* noop */
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /algo salió mal/i })).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("reload button is keyboard-focusable and invokes onReload", async () => {
    const onReload = vi.fn();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* noop */
    });
    render(
      <ErrorBoundary onReload={onReload}>
        <Boom />
      </ErrorBoundary>,
    );
    const btn = screen.getByTestId("error-boundary-reload");
    btn.focus();
    expect(btn).toHaveFocus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    expect(onReload).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
