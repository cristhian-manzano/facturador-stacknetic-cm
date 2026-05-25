/**
 * Tests for `/invoices/:id/edit` (SPEC-0042 / TASKS-0042 §1.2).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { InvoicesEditPage } from "./invoices.$id.edit.js";

const ME = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "STUB S.A.",
      role: "OWNER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "OWNER" as const,
  permissions: ["invoice.create", "invoice.read"],
};

const ESTABLECIMIENTOS = [
  {
    id: "01KS5R6NXR0MY0X8SFHAH0GYAA",
    codigo: "001",
    direccion: "Av X",
    isMatriz: true,
    createdAt: "2026-05-25T00:00:00Z",
    updatedAt: "2026-05-25T00:00:00Z",
  },
];

const EMISSION_POINTS = [
  {
    id: "01KS5R6NXR0MY0X8SFHAH0GYBB",
    establecimientoId: ESTABLECIMIENTOS[0]!.id,
    codigo: "001",
    descripcion: "P",
    isDefault: true,
    createdAt: "2026-05-25T00:00:00Z",
    updatedAt: "2026-05-25T00:00:00Z",
  },
];

function buildInvoice(estado: "BORRADOR" | "EMITIDO") {
  return {
    invoice: {
      id: "01KS5R6NXR0MY0X8SFHAH0GYDD",
      companyId: ME.activeCompanyId,
      customerId: "01KS5R6NXR0MY0X8SFHAH0GYCC",
      emissionPointId: EMISSION_POINTS[0]!.id,
      estado,
      codDoc: "01",
      estab: "001",
      ptoEmi: "001",
      secuencial: null,
      claveAcceso: null,
      fechaEmision: "2026-05-25",
      moneda: "DOLAR",
      obligadoContabilidad: false,
      contribuyenteEspecial: null,
      totalSinImpuestos: 100,
      totalDescuento: 0,
      totalConImpuestos: [
        { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
      ],
      propina: 0,
      importeTotal: 115,
      lines: [
        {
          orden: 0,
          descripcion: "Servicio existente",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          precioTotalSinImpuesto: 100,
          impuestos: [
            { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
          ],
        },
      ],
      payments: [{ formaPago: "01", total: 115 }],
      adicionales: [],
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
    },
    customer: {
      id: "01KS5R6NXR0MY0X8SFHAH0GYCC",
      companyId: ME.activeCompanyId,
      tipoIdentificacion: "05",
      identificacion: "1710034065",
      razonSocial: "Pepito Pérez",
      isActive: true,
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
      deletedAt: null,
    },
    sriDocument: null,
    sriEvents: [],
  };
}

function mount(invoiceId: string) {
  const routes: RouteObject[] = [
    { path: "/invoices/:id/edit", element: <InvoicesEditPage /> },
    { path: "/invoices/:id", element: <div data-testid="invoice-detail">DETAIL</div> },
    { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [`/invoices/${invoiceId}/edit`] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider initialState={ME}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const ID_BORRADOR = "01KS5R6NXR0MY0X8SFHAH0GYDD";
const ID_EMITIDO = "01KS5R6NXR0MY0X8SFHAH0GYEE";

describe("/invoices/:id/edit", () => {
  it("BORRADOR: renders the form hydrated with the existing line", async () => {
    mswServer.use(
      http.get("/api/v1/me", () => HttpResponse.json(ME)),
      http.get("/api/v1/establecimientos", () => HttpResponse.json(ESTABLECIMIENTOS)),
      http.get("/api/v1/establecimientos/:id/emission-points", () =>
        HttpResponse.json(EMISSION_POINTS),
      ),
      http.get(`/api/v1/invoices/${ID_BORRADOR}`, () =>
        HttpResponse.json(buildInvoice("BORRADOR")),
      ),
    );
    mount(ID_BORRADOR);
    expect(await screen.findByDisplayValue(/Servicio existente/)).toBeInTheDocument();
  });

  it("EMITIDO: shows the locked banner with link to detail", async () => {
    mswServer.use(
      http.get("/api/v1/me", () => HttpResponse.json(ME)),
      http.get(`/api/v1/invoices/${ID_EMITIDO}`, () => {
        const detail = buildInvoice("EMITIDO");
        detail.invoice.id = ID_EMITIDO;
        return HttpResponse.json(detail);
      }),
    );
    mount(ID_EMITIDO);
    expect(await screen.findByTestId("invoice-locked-banner")).toBeInTheDocument();
    expect(screen.getByText(/Ver detalle/)).toBeInTheDocument();
  });
});
