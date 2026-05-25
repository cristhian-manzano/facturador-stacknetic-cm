/**
 * `LineRow` test — RHF integration + inline parse-money errors + Enter shortcut.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import type { ReactElement, ReactNode } from "react";

import { LineRow } from "./line-row.js";
import type { InvoiceFormValues } from "./types.js";

function Harness({
  children,
  defaultValues,
}: {
  children: ReactNode;
  defaultValues?: Partial<InvoiceFormValues>;
}): ReactElement {
  const form = useForm<InvoiceFormValues>({
    defaultValues: {
      emissionPointId: "",
      customerId: "",
      fechaEmision: "2026-05-25",
      lines: [
        {
          descripcion: "",
          cantidad: "1",
          precioUnitario: "0",
          descuento: "0",
          codigoPorcentaje: "4",
          tarifa: 15,
        },
      ],
      payments: [{ formaPago: "01", total: "0" }],
      adicionales: [],
      ...defaultValues,
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("<LineRow>", () => {
  it("renders all fields with labels", () => {
    render(
      <Harness>
        <LineRow index={0} canRemove={false} isLast={true} onRemove={() => undefined} />
      </Harness>,
    );
    expect(screen.getByLabelText(/Descripción/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cantidad/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Precio unitario/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Descuento/)).toBeInTheDocument();
    expect(screen.getByLabelText(/IVA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quitar línea/ })).toBeDisabled();
  });

  it("flips remove button to enabled when canRemove", () => {
    render(
      <Harness>
        <LineRow index={0} canRemove={true} isLast={true} onRemove={() => undefined} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /Quitar línea/ })).toBeEnabled();
  });

  it("shows inline parse-money error for invalid cantidad", async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <LineRow index={0} canRemove={false} isLast={true} onRemove={() => undefined} />
      </Harness>,
    );
    const cantidad = screen.getByLabelText(/Cantidad/);
    await user.clear(cantidad);
    await user.type(cantidad, "abc");
    expect(await screen.findByText(/Valor numérico inválido/)).toBeInTheDocument();
  });

  it("Enter inside the last input fires onLastFieldEnter when isLast", async () => {
    const user = userEvent.setup();
    const onLastFieldEnter = vi.fn();
    render(
      <Harness>
        <LineRow
          index={0}
          canRemove={false}
          isLast={true}
          onRemove={() => undefined}
          onLastFieldEnter={onLastFieldEnter}
        />
      </Harness>,
    );
    const iva = screen.getByLabelText(/IVA/);
    iva.focus();
    await user.keyboard("{Enter}");
    expect(onLastFieldEnter).toHaveBeenCalledOnce();
  });

  it("Enter does NOT fire on non-last row", async () => {
    const user = userEvent.setup();
    const onLastFieldEnter = vi.fn();
    render(
      <Harness>
        <LineRow
          index={0}
          canRemove={true}
          isLast={false}
          onRemove={() => undefined}
          onLastFieldEnter={onLastFieldEnter}
        />
      </Harness>,
    );
    const iva = screen.getByLabelText(/IVA/);
    iva.focus();
    await user.keyboard("{Enter}");
    expect(onLastFieldEnter).not.toHaveBeenCalled();
  });
});
