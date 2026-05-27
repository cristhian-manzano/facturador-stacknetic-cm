/**
 * Tests for `<InvoicesTable />` (TASKS-0043 §1.3).
 *
 * Covers:
 *   - Header row snapshot — column labels in stable order.
 *   - Renders one row per item.
 *   - Money rendered via formatMoney (es-EC, two decimals).
 *   - Clicking a row navigates to `/invoices/:id`.
 *   - The "Ver detalle" link is keyboard-focusable.
 *   - Does NOT render emails or phones (verified by absence of the
 *     fields from the prop shape).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { InvoiceListItem } from "@facturador/contracts/invoices";

import { InvoicesTable, formatFechaEs } from "./invoices-table.js";

function makeItem(over: Partial<InvoiceListItem> = {}): InvoiceListItem {
  // Cast through `unknown` to drop the contracts' branded primitives
  // (Ulid / IsoDate / Estab / …) — the table component reads them as
  // plain strings, and Zod-parsing each fixture would add noise.
  return {
    id: "01HX8K0PYFA9B7Y1M2N3P4Q5AA",
    estado: "EMITIDO",
    fechaEmision: "2026-05-19",
    customerRazonSocial: "ACME S.A.",
    estab: "001",
    ptoEmi: "001",
    secuencial: "000000001",
    importeTotal: 115,
    sriEstado: "AUTORIZADO",
    claveAcceso: "1905202601179001234400110010010000001231234567812",
    ...over,
  } as unknown as InvoiceListItem;
}

function mount(items: readonly InvoiceListItem[]) {
  return render(
    <MemoryRouter initialEntries={["/invoices"]}>
      <Routes>
        <Route path="/invoices" element={<InvoicesTable items={items} />} />
        <Route path="/invoices/:id" element={<div data-testid="detail-stub">DETAIL</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("formatFechaEs", () => {
  it("formats YYYY-MM-DD as DD/MM/YYYY", () => {
    expect(formatFechaEs("2026-05-19")).toBe("19/05/2026");
  });

  it("formats a full ISO timestamp by slicing the date part", () => {
    expect(formatFechaEs("2026-05-19T10:00:00Z")).toBe("19/05/2026");
  });
});

describe("<InvoicesTable /> rendering", () => {
  it("header row contains all 7 column labels", () => {
    mount([]);
    const header = screen.getByTestId("invoices-table-header");
    const ths = within(header).getAllByRole("columnheader");
    expect(ths.map((th) => th.textContent)).toEqual([
      "Fecha",
      "Cliente",
      "Estab-Pto-Sec",
      "Total",
      "Estado",
      "Estado SRI",
      "Acciones",
    ]);
  });

  it("renders one row per item", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        id: `01HX8K0PYFA9B7Y1M2N3P4Q5${String(i).padStart(2, "0")}` as unknown as InvoiceListItem["id"],
      }),
    );
    mount(items);
    expect(screen.getAllByRole("row")).toHaveLength(11); // header + 10
  });

  it("displays the importeTotal formatted as money", () => {
    mount([makeItem({ importeTotal: 1234.5 })]);
    expect(screen.getByText(/1[,.]?234[,.]?50/)).toBeInTheDocument();
  });

  it("clicking a row navigates to the detail route", async () => {
    const user = userEvent.setup();
    const items = [makeItem()];
    mount(items);
    await user.click(screen.getByTestId(`invoice-row-${items[0]!.id}`));
    expect(await screen.findByTestId("detail-stub")).toBeInTheDocument();
  });

  it("the Ver detalle link navigates as well (keyboard-friendly)", async () => {
    const user = userEvent.setup();
    const items = [makeItem()];
    mount(items);
    await user.click(screen.getByTestId(`invoice-row-link-${items[0]!.id}`));
    expect(await screen.findByTestId("detail-stub")).toBeInTheDocument();
  });

  it("does NOT include phone / email markup", () => {
    mount([makeItem()]);
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.queryByText(/teléfono/i)).toBeNull();
  });
});
