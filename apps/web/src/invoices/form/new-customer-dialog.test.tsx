/**
 * `NewCustomerDialog` tests (SPEC-0042 §FR-3 / TASKS-0042 §2.6).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../../lib/api.js";
import { NewCustomerDialog } from "./new-customer-dialog.js";

describe("<NewCustomerDialog>", () => {
  it("returns null when closed", () => {
    const { container } = render(
      <NewCustomerDialog open={false} onClose={() => undefined} onCreated={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a labelled dialog when open", () => {
    render(<NewCustomerDialog open={true} onClose={() => undefined} onCreated={() => undefined} />);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg).toHaveAccessibleName(/Nuevo cliente/);
  });

  it("happy path: submit creates customer + fires onCreated + closes", async () => {
    const creator = vi.fn(async () => ({
      id: "cust-new",
      tipoIdentificacion: "05",
      identificacion: "1700000001",
      razonSocial: "Pepito Pérez",
      nombreComercial: null,
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
    }));
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <NewCustomerDialog
        open={true}
        onClose={onClose}
        onCreated={onCreated}
        creator={creator as unknown as typeof import("../api.js").createCustomer}
      />,
    );
    await user.type(screen.getByLabelText(/Identificación/), "1700000001");
    await user.type(screen.getByLabelText(/Razón social/), "Pepito Pérez");
    await user.click(screen.getByTestId("new-customer-submit"));
    await waitFor(() => { expect(creator).toHaveBeenCalledOnce(); });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated.mock.calls[0]?.[0]?.id).toBe("cust-new");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("server 400 with field error → inline error", async () => {
    const creator = vi.fn(async () => {
      throw new ApiError({
        type: "about:blank",
        title: "bad request",
        status: 400,
        code: "validation.error",
        errors: [{ identificador: "identificacion", mensaje: "cédula inválida", tipo: "ERROR" }],
      });
    });
    const user = userEvent.setup();
    render(
      <NewCustomerDialog
        open={true}
        onClose={() => undefined}
        onCreated={() => undefined}
        creator={creator as unknown as typeof import("../api.js").createCustomer}
      />,
    );
    await user.type(screen.getByLabelText(/Identificación/), "00");
    await user.type(screen.getByLabelText(/Razón social/), "X");
    await user.click(screen.getByTestId("new-customer-submit"));
    expect(await screen.findByText("cédula inválida")).toBeInTheDocument();
  });

  it("Esc closes when not submitting", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NewCustomerDialog open={true} onClose={onClose} onCreated={() => undefined} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
