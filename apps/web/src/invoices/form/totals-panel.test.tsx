/**
 * `TotalsPanel` test.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TotalsPanel } from "./totals-panel.js";

describe("<TotalsPanel>", () => {
  it("renders zeros when totals is null", () => {
    render(<TotalsPanel totals={null} isPending={false} paymentsBalanced={true} />);
    expect(screen.getByTestId("totals-total")).toHaveTextContent(/0[.,]00/);
  });

  it("renders subtotal / IVA / total from the API response", () => {
    render(
      <TotalsPanel
        totals={{
          lines: [],
          totalSinImpuestos: 100,
          totalDescuento: 0,
          totalConImpuestos: [
            { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
          ],
          propina: 0,
          importeTotal: 115,
        }}
        isPending={false}
        paymentsBalanced={true}
      />,
    );
    expect(screen.getByTestId("totals-subtotal")).toHaveTextContent(/100/);
    expect(screen.getByTestId("totals-iva")).toHaveTextContent(/15[.,]00/);
    expect(screen.getByTestId("totals-total")).toHaveTextContent(/115/);
  });

  it("shows a pending indicator while loading", () => {
    render(<TotalsPanel totals={null} isPending={true} paymentsBalanced={true} />);
    expect(screen.getByTestId("totals-pending")).toBeInTheDocument();
  });

  it("shows the payment mismatch chip when unbalanced", () => {
    render(<TotalsPanel totals={null} isPending={false} paymentsBalanced={false} />);
    expect(screen.getByTestId("payment-mismatch-chip")).toBeInTheDocument();
  });
});
