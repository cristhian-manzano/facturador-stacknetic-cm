/**
 * `PaymentRow` test.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { PaymentRow } from "./payment-row.js";
import type { InvoiceFormValues } from "./types.js";

function Harness({ children }: { children: ReactNode }): ReactElement {
  const form = useForm<InvoiceFormValues>({
    defaultValues: {
      emissionPointId: "",
      customerId: "",
      fechaEmision: "2026-05-25",
      lines: [],
      payments: [{ formaPago: "01", total: "0" }],
      adicionales: [],
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("<PaymentRow>", () => {
  it("renders fields with labels", () => {
    render(
      <Harness>
        <PaymentRow index={0} canRemove={true} onRemove={() => undefined} />
      </Harness>,
    );
    expect(screen.getByLabelText(/Forma de pago/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Total$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quitar pago/ })).toBeEnabled();
  });

  it("inline parse-money error when total is invalid", async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <PaymentRow index={0} canRemove={true} onRemove={() => undefined} />
      </Harness>,
    );
    const total = screen.getByLabelText(/^Total$/);
    await user.clear(total);
    await user.type(total, "xyz");
    expect(await screen.findByText(/Valor numérico inválido/)).toBeInTheDocument();
  });
});
