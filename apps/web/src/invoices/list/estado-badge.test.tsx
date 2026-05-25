/**
 * Tests for `<EstadoBadge />` + `<SriEstadoBadge />`.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EstadoBadge, SriEstadoBadge } from "./estado-badge.js";

describe("<EstadoBadge />", () => {
  it.each(["BORRADOR", "EMITIDO", "ANULADO"] as const)(
    "renders estado=%s with its testid",
    (estado) => {
      render(<EstadoBadge estado={estado} />);
      expect(screen.getByTestId(`estado-badge-${estado}`)).toBeInTheDocument();
    },
  );
});

describe("<SriEstadoBadge />", () => {
  it("renders the 'none' badge when estado is null", () => {
    render(<SriEstadoBadge estado={null} />);
    expect(screen.getByTestId("sri-estado-badge-none")).toBeInTheDocument();
  });

  it("renders the 'none' badge when estado is undefined", () => {
    render(<SriEstadoBadge estado={undefined} />);
    expect(screen.getByTestId("sri-estado-badge-none")).toBeInTheDocument();
  });

  it.each([
    "PENDIENTE",
    "FIRMADO",
    "ENVIADO",
    "RECIBIDA",
    "EN_PROCESO",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "DEVUELTA",
    "ERROR_RED",
    "ERROR_BUILD",
  ] as const)("renders sriEstado=%s with its testid", (estado) => {
    render(<SriEstadoBadge estado={estado} />);
    expect(screen.getByTestId(`sri-estado-badge-${estado}`)).toBeInTheDocument();
  });
});
