/**
 * Tests for `<FiltersBar />` (TASKS-0043 §1.2 + REVIEW-0044 §5 multi-select).
 *
 * Covers:
 *   - Selecting estado=EMITIDO sets `?estado=EMITIDO` in the URL.
 *   - Selecting EMITIDO + ANULADO sets `?estado=EMITIDO,ANULADO` (comma form).
 *   - Toggling a chip a second time removes it from the URL.
 *   - Typing in the q field sets `?q=` after every keystroke.
 *   - Changing a filter clears any existing `?cursor=`.
 *   - "Limpiar filtros" wipes every search param.
 *   - URL is read back into chip pressed state (both repeated AND comma form).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FiltersBar, parseEstadoFromSearch } from "./filters-bar.js";

function Probe(): JSX.Element {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function mount(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <FiltersBar />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<FiltersBar /> URL state", () => {
  it("clicking the EMITIDO chip sets ?estado=EMITIDO", async () => {
    const user = userEvent.setup();
    mount("/invoices");
    await user.click(screen.getByTestId("filter-estado-EMITIDO"));
    expect(screen.getByTestId("loc").textContent).toContain("estado=EMITIDO");
  });

  it("EMITIDO + ANULADO produces canonical comma-form ?estado=EMITIDO%2CANULADO", async () => {
    const user = userEvent.setup();
    mount("/invoices");
    await user.click(screen.getByTestId("filter-estado-EMITIDO"));
    await user.click(screen.getByTestId("filter-estado-ANULADO"));
    const loc = screen.getByTestId("loc").textContent ?? "";
    // URLSearchParams encodes the comma as %2C.
    expect(loc).toContain("estado=EMITIDO%2CANULADO");
  });

  it("clicking a selected chip again removes that estado", async () => {
    const user = userEvent.setup();
    mount("/invoices?estado=EMITIDO,ANULADO");
    await user.click(screen.getByTestId("filter-estado-ANULADO"));
    const loc = screen.getByTestId("loc").textContent ?? "";
    expect(loc).toContain("estado=EMITIDO");
    expect(loc).not.toContain("ANULADO");
  });

  it("removing the last estado deletes the param entirely", async () => {
    const user = userEvent.setup();
    mount("/invoices?estado=EMITIDO");
    await user.click(screen.getByTestId("filter-estado-EMITIDO"));
    expect(screen.getByTestId("loc").textContent ?? "").not.toContain("estado=");
  });

  it("typing in q sets ?q=", async () => {
    const user = userEvent.setup();
    mount("/invoices");
    await user.type(screen.getByTestId("filter-q"), "ACME");
    expect(screen.getByTestId("loc").textContent).toMatch(/q=ACME/);
  });

  it("changing estado clears an existing cursor", async () => {
    const user = userEvent.setup();
    mount("/invoices?cursor=abc123");
    await user.click(screen.getByTestId("filter-estado-BORRADOR"));
    const loc = screen.getByTestId("loc").textContent ?? "";
    expect(loc).toContain("estado=BORRADOR");
    expect(loc).not.toContain("cursor=abc123");
  });

  it("'Limpiar filtros' wipes all search params", async () => {
    const user = userEvent.setup();
    mount("/invoices?estado=EMITIDO&from=2026-01-01&q=ACME");
    expect(screen.getByTestId("filters-clear")).toBeVisible();
    await user.click(screen.getByTestId("filters-clear"));
    expect(screen.getByTestId("loc").textContent).toBe("");
  });

  it("reads existing URL params back into chip pressed state (comma form)", () => {
    mount("/invoices?estado=BORRADOR,EMITIDO&q=zz");
    expect(screen.getByTestId("filter-estado-BORRADOR")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("filter-estado-EMITIDO")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("filter-estado-ANULADO")).toHaveAttribute("aria-checked", "false");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    expect((screen.getByTestId("filter-q") as HTMLInputElement).value).toBe("zz");
  });

  it("reads legacy repeated-form ?estado=A&estado=B into chip state", () => {
    mount("/invoices?estado=BORRADOR&estado=ANULADO");
    expect(screen.getByTestId("filter-estado-BORRADOR")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("filter-estado-ANULADO")).toHaveAttribute("aria-checked", "true");
  });
});

describe("parseEstadoFromSearch", () => {
  it("parses comma-form", () => {
    const result = parseEstadoFromSearch(new URLSearchParams("estado=EMITIDO,ANULADO"));
    expect(result).toEqual(["EMITIDO", "ANULADO"]);
  });

  it("parses repeated-form", () => {
    const result = parseEstadoFromSearch(new URLSearchParams("estado=EMITIDO&estado=ANULADO"));
    expect(result).toEqual(["EMITIDO", "ANULADO"]);
  });

  it("drops unknown values", () => {
    const result = parseEstadoFromSearch(new URLSearchParams("estado=EMITIDO,UNKNOWN,ANULADO"));
    expect(result).toEqual(["EMITIDO", "ANULADO"]);
  });

  it("de-duplicates repeats", () => {
    const result = parseEstadoFromSearch(new URLSearchParams("estado=EMITIDO,EMITIDO"));
    expect(result).toEqual(["EMITIDO"]);
  });
});
