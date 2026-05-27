/**
 * Tests for `<ClaveAccesoChip />` (TASKS-0043 §4.1).
 *
 * Covers:
 *   - 49-digit clave is formatted in groups of 4 (+ trailing check
 *     digit).
 *   - Click on the copy button invokes
 *     `navigator.clipboard.writeText` with the RAW 49-digit string
 *     (no spaces).
 *   - When `navigator.clipboard` is unavailable, the click is a no-op
 *     (button still rendered + label flips to "No se pudo copiar").
 *   - The formatter is total: empty string in → empty string out.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaveAccesoChip, formatClaveAcceso } from "./clave-acceso-chip.js";

const RAW_CLAVE = "1905202601179001234400110010010000001231234567812"; // 49 digits

/**
 * Helper: pin `navigator.clipboard` to a given shape (or undefined to
 * simulate unsupported environments). userEvent installs its own
 * clipboard polyfill, so we re-define after each setup.
 */
function setClipboard(value: { writeText: (s: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
    writable: true,
  });
}

let originalClipboard: PropertyDescriptor | undefined;

beforeEach(() => {
  originalClipboard =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), "clipboard") ??
    Object.getOwnPropertyDescriptor(navigator, "clipboard");
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore the original clipboard (jsdom's polyfill, or absent).
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
});

describe("formatClaveAcceso", () => {
  it("inserts a space every 4 characters", () => {
    expect(formatClaveAcceso(RAW_CLAVE)).toBe(
      "1905 2026 0117 9001 2344 0011 0010 0100 0000 1231 2345 6781 2",
    );
  });

  it("returns empty string for empty input", () => {
    expect(formatClaveAcceso("")).toBe("");
  });
});

describe("<ClaveAccesoChip />", () => {
  it("renders the formatted clave + a copy button", () => {
    render(<ClaveAccesoChip clave={RAW_CLAVE} />);
    expect(screen.getByTestId("clave-acceso-formatted")).toHaveTextContent("1905 2026 0117");
    expect(screen.getByTestId("clave-acceso-copy")).toBeInTheDocument();
  });

  it("clicking the button calls navigator.clipboard.writeText with the RAW value", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<ClaveAccesoChip clave={RAW_CLAVE} />);
    fireEvent.click(screen.getByTestId("clave-acceso-copy"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(RAW_CLAVE);
    // Label flips to "Copiada".
    await waitFor(() => {
      expect(screen.getByTestId("clave-acceso-copy")).toHaveTextContent(/Copiada/);
    });
  });

  it("falls back to a no-op + error label when clipboard is unsupported", async () => {
    setClipboard(undefined);
    render(<ClaveAccesoChip clave={RAW_CLAVE} />);
    fireEvent.click(screen.getByTestId("clave-acceso-copy"));
    await waitFor(() => {
      expect(screen.getByTestId("clave-acceso-copy")).toHaveTextContent(/No se pudo copiar/);
    });
  });

  it("flips to error label when clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });
    render(<ClaveAccesoChip clave={RAW_CLAVE} />);
    fireEvent.click(screen.getByTestId("clave-acceso-copy"));
    await waitFor(() => {
      expect(screen.getByTestId("clave-acceso-copy")).toHaveTextContent(/No se pudo copiar/);
    });
  });
});
