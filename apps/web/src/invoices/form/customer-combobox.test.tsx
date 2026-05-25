/**
 * `CustomerCombobox` tests (SPEC-0042 §FR-3 / TASKS-0042 §2.5).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomerCombobox } from "./customer-combobox.js";
import type { CustomerListItem, CustomerListResponse } from "../api.js";

function makeItem(idx: number): CustomerListItem {
  return {
    id: `cust-${idx.toString()}`,
    tipoIdentificacion: "05",
    identificacion: `170000000${idx.toString()}`,
    razonSocial: `Acme ${idx.toString()}`,
    nombreComercial: null,
    createdAt: "2026-05-25T00:00:00Z",
    updatedAt: "2026-05-25T00:00:00Z",
  };
}

describe("<CustomerCombobox>", () => {
  it("renders the input + 'Nuevo cliente' button with aria roles", () => {
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={() => undefined}
        onCreateNewRequested={() => undefined}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/Nuevo cliente/)).toBeInTheDocument();
  });

  it("does NOT fire search below 2 chars", async () => {
    const searcher = vi.fn(async () => ({ items: [], nextCursor: null }) as CustomerListResponse);
    const user = userEvent.setup();
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={() => undefined}
        onCreateNewRequested={() => undefined}
        searcher={searcher}
        debounceMs={5}
      />,
    );
    await user.type(screen.getByRole("combobox"), "a");
    // Wait past the debounce.
    await new Promise((r) => setTimeout(r, 30));
    expect(searcher).not.toHaveBeenCalled();
  });

  it("fires search after ≥ 2 chars (debounced) and renders results", async () => {
    const items = [makeItem(1), makeItem(2)];
    const searcher = vi.fn(async () => ({ items, nextCursor: null }) as CustomerListResponse);
    const user = userEvent.setup();
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={() => undefined}
        onCreateNewRequested={() => undefined}
        searcher={searcher}
        debounceMs={10}
      />,
    );
    await user.type(screen.getByRole("combobox"), "ac");
    await waitFor(() => { expect(searcher).toHaveBeenCalledWith("ac", expect.anything()); });
    expect(await screen.findByText("Acme 1")).toBeInTheDocument();
    expect(screen.getByText("Acme 2")).toBeInTheDocument();
  });

  it("selecting an option calls onSelect with the customer", async () => {
    const items = [makeItem(1)];
    const searcher = vi.fn(async () => ({ items, nextCursor: null }) as CustomerListResponse);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={onSelect}
        onCreateNewRequested={() => undefined}
        searcher={searcher}
        debounceMs={5}
      />,
    );
    await user.type(screen.getByRole("combobox"), "ac");
    const opt = await screen.findByTestId(`customer-option-${items[0]?.id ?? ""}`);
    await user.click(opt);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe(items[0]?.id);
  });

  it("'Nuevo cliente' button triggers onCreateNewRequested", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={() => undefined}
        onCreateNewRequested={onCreate}
      />,
    );
    await user.click(screen.getByText(/Nuevo cliente/));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("debounces rapid keystrokes to a single call", async () => {
    const searcher = vi.fn(async () => ({ items: [], nextCursor: null }) as CustomerListResponse);
    const user = userEvent.setup();
    render(
      <CustomerCombobox
        value=""
        selectedLabel=""
        onSelect={() => undefined}
        onCreateNewRequested={() => undefined}
        searcher={searcher}
        debounceMs={50}
      />,
    );
    await user.type(screen.getByRole("combobox"), "abcdef");
    await waitFor(() => { expect(searcher).toHaveBeenCalledTimes(1); });
  });
});
