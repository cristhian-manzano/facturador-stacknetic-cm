/**
 * Tests for `<OfflineBanner />` (REVIEW-0044 §UX).
 *
 * Covers:
 *   - Renders nothing while online.
 *   - Renders the banner when the `offline` event fires.
 *   - Removes the banner when the `online` event fires.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineBanner } from "./OfflineBanner.js";

function setNavigatorOnline(value: boolean): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(navigator),
    "onLine",
  );
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
  return () => {
    if (originalDescriptor !== undefined) {
      Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", originalDescriptor);
    }
  };
}

afterEach(() => {
  // Force online for the next test.
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("<OfflineBanner />", () => {
  it("renders nothing while online", () => {
    const restore = setNavigatorOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    restore();
  });

  it("renders the banner when an 'offline' event fires", () => {
    const restore = setNavigatorOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("Sin conexión");
    restore();
  });

  it("removes the banner when an 'online' event fires", () => {
    const restore = setNavigatorOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    restore();
  });
});
