/**
 * Tests for `<FiltersBar />` (TASKS-0043 §1.2).
 *
 * Covers:
 *   - Selecting estado=EMITIDO sets `?estado=EMITIDO` in the URL.
 *   - Typing in the q field sets `?q=` after every keystroke.
 *   - Changing a filter clears any existing `?cursor=`.
 *   - "Limpiar filtros" wipes every search param.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

import { FiltersBar } from "./filters-bar.js";

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
  it("selecting estado=EMITIDO sets ?estado=EMITIDO", async () => {
    const user = userEvent.setup();
    mount("/invoices");
    await user.selectOptions(screen.getByTestId("filter-estado"), "EMITIDO");
    expect(screen.getByTestId("loc").textContent).toContain("estado=EMITIDO");
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
    await user.selectOptions(screen.getByTestId("filter-estado"), "BORRADOR");
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

  it("selecting the 'Todos' option (empty value) removes the estado param", async () => {
    const user = userEvent.setup();
    mount("/invoices?estado=EMITIDO");
    await user.selectOptions(screen.getByTestId("filter-estado"), "");
    expect(screen.getByTestId("loc").textContent ?? "").not.toContain("estado=");
  });

  it("reads existing URL params into the inputs on first render", () => {
    mount("/invoices?estado=BORRADOR&q=zz");
    expect((screen.getByTestId("filter-estado") as HTMLSelectElement).value).toBe("BORRADOR");
    expect((screen.getByTestId("filter-q") as HTMLInputElement).value).toBe("zz");
  });
});
