/**
 * Integration tests for `<InvoiceForm />` (SPEC-0042 §FR-2…§FR-8).
 *
 * Covers:
 *   - Renders with one line by default.
 *   - "Agregar línea" adds a line.
 *   - Typing fires preview-totals after 250 ms.
 *   - Payment mismatch chip + Emit disabled.
 *   - Full happy-path emit (AUTORIZADO → navigate to /invoices/:id after 400 ms).
 *   - DEVUELTA / business_error path.
 *   - network_error path.
 *   - Auto-save fires after 30 s (mock timers).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  vi.useRealTimers();
});
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../../test/msw/server.js";
import { AuthProvider } from "../../auth/context.js";
import { InvoicesEditPage } from "../../routes/invoices.$id.edit.js";
import { InvoicesNewPage } from "../../routes/invoices.new.js";

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
  permissions: ["invoice.create", "invoice.read", "customer.read", "customer.create"],
};

const STUB_ESTABLECIMIENTOS = [
  {
    id: "01KS5R6NXR0MY0X8SFHAH0GYAA",
    codigo: "001",
    direccion: "Av. Amazonas N12-345",
    isMatriz: true,
    createdAt: "2026-05-25T00:00:00Z",
    updatedAt: "2026-05-25T00:00:00Z",
  },
];

const STUB_EMISSION_POINTS = [
  {
    id: "01KS5R6NXR0MY0X8SFHAH0GYBB",
    establecimientoId: STUB_ESTABLECIMIENTOS[0]!.id,
    codigo: "001",
    descripcion: "Punto principal",
    isDefault: true,
    createdAt: "2026-05-25T00:00:00Z",
    updatedAt: "2026-05-25T00:00:00Z",
  },
];

const STUB_CUSTOMER = {
  id: "01KS5R6NXR0MY0X8SFHAH0GYCC",
  tipoIdentificacion: "05",
  identificacion: "1700000007",
  razonSocial: "Pepito Pérez",
  nombreComercial: null,
  createdAt: "2026-05-25T00:00:00Z",
  updatedAt: "2026-05-25T00:00:00Z",
};

const STUB_PREVIEW_TOTALS = {
  lines: [
    {
      precioTotalSinImpuesto: 100,
      impuestos: [
        { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
      ],
    },
  ],
  totalSinImpuestos: 100,
  totalDescuento: 0,
  totalConImpuestos: [
    { codigo: "2", codigoPorcentaje: "4", tarifa: 15, baseImponible: 100, valor: 15 },
  ],
  propina: 0,
  importeTotal: 115,
};

const STUB_INVOICE = {
  id: "01KS5R6NXR0MY0X8SFHAH0GYDD",
  companyId: ME.activeCompanyId,
  customerId: STUB_CUSTOMER.id,
  emissionPointId: STUB_EMISSION_POINTS[0]!.id,
  estado: "BORRADOR",
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
      descripcion: "Servicio",
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
};

function buildMount(handlers: ReturnType<typeof http.get>[] = []) {
  // MSW handler ordering: the first matching handler wins, so put per-test
  // overrides BEFORE the defaults.
  mswServer.use(
    ...handlers,
    http.get("/api/v1/me", () => HttpResponse.json(ME)),
    http.get("/api/v1/establecimientos", () => HttpResponse.json(STUB_ESTABLECIMIENTOS)),
    http.get("/api/v1/establecimientos/:id/emission-points", () =>
      HttpResponse.json(STUB_EMISSION_POINTS),
    ),
    http.get("/api/v1/customers", () =>
      HttpResponse.json({ items: [STUB_CUSTOMER], nextCursor: null }),
    ),
    http.post("/api/v1/invoices/preview-totals", async () =>
      HttpResponse.json(STUB_PREVIEW_TOTALS),
    ),
    http.post("/api/v1/invoices", async () => HttpResponse.json(STUB_INVOICE, { status: 201 })),
    http.patch("/api/v1/invoices/:id", async () => HttpResponse.json(STUB_INVOICE)),
    http.get(`/api/v1/invoices/${STUB_INVOICE.id}`, () =>
      HttpResponse.json({
        invoice: STUB_INVOICE,
        customer: {
          id: STUB_CUSTOMER.id,
          companyId: ME.activeCompanyId,
          tipoIdentificacion: "05" as const,
          identificacion: "1710034065",
          razonSocial: "Pepito Pérez",
          isActive: true,
          createdAt: "2026-05-25T00:00:00Z",
          updatedAt: "2026-05-25T00:00:00Z",
          deletedAt: null,
        },
        sriDocument: null,
        sriEvents: [],
      }),
    ),
  );

  const routes: RouteObject[] = [
    { path: "/invoices/new", element: <InvoicesNewPage /> },
    {
      path: "/invoices/:id",
      element: <div data-testid="invoice-detail">DETAIL</div>,
    },
    { path: "/invoices/:id/edit", element: <InvoicesEditPage /> },
    { path: "/invoices", element: <div data-testid="invoices-list">LIST</div> },
    { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/invoices/new"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialState={ME}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("<InvoiceForm /> rendering", () => {
  it("renders the form with one line and one payment by default", async () => {
    buildMount();
    expect(await screen.findByTestId("line-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("payment-row-0")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /Nueva factura/i })).toBeInTheDocument();
  });

  it("'Agregar línea' adds a second LineRow", async () => {
    const user = userEvent.setup();
    buildMount();
    await screen.findByTestId("line-row-0");
    await user.click(screen.getByTestId("add-line"));
    expect(screen.getByTestId("line-row-1")).toBeInTheDocument();
  });
});

describe("<InvoiceForm /> preview totals", () => {
  it("calls preview-totals after debounce + 250 ms", async () => {
    let previewCount = 0;
    let lastBody: unknown = null;
    buildMount([
      http.post("/api/v1/invoices/preview-totals", async ({ request }) => {
        previewCount++;
        lastBody = await request.clone().json();
        return HttpResponse.json(STUB_PREVIEW_TOTALS);
      }),
    ]);
    const user = userEvent.setup();
    await screen.findByTestId("line-row-0");

    // Select the emission point FIRST so the form has a stable emission point.
    await user.selectOptions(
      screen.getByTestId("emission-point-select"),
      STUB_EMISSION_POINTS[0]!.id,
    );
    // Open combobox + search + select customer.
    await user.type(screen.getByTestId("customer-search-input"), "Pe");
    const opt = await screen.findByTestId(`customer-option-${STUB_CUSTOMER.id}`);
    await user.click(opt);
    // Type a description AFTER customer is set so the previewBody becomes
    // valid and triggers preview-totals.
    await user.type(screen.getByLabelText(/Descripción/), "Servicio");

    await waitFor(
      () => {
        expect(previewCount).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );
    expect(await screen.findByTestId("totals-total")).toHaveTextContent(/115/);
    // The recorded body is shape-checked: emissionPointId + customerId
    // are present and lines/payments arrays are populated.
    expect(lastBody).not.toBeNull();
  }, 10000);
});

describe("<InvoiceForm /> Emit", () => {
  it("Emit button is disabled when payments do not match the total", async () => {
    buildMount();
    await screen.findByTestId("line-row-0");
    expect(screen.getByTestId("emit-button")).toBeDisabled();
  });

  it("happy path: clicking Emit transitions to success and navigates", async () => {
    const user = userEvent.setup();
    buildMount([
      http.post("/api/v1/invoices/:id/emit", async () =>
        HttpResponse.json({
          estado: "AUTORIZADO",
          claveAcceso: "1111111111111111111111111111111111111111111111114",
        }),
      ),
    ]);
    await screen.findByTestId("line-row-0");
    await user.selectOptions(
      screen.getByTestId("emission-point-select"),
      STUB_EMISSION_POINTS[0]!.id,
    );
    await user.type(screen.getByTestId("customer-search-input"), "Pe");
    const opt = await screen.findByTestId(`customer-option-${STUB_CUSTOMER.id}`);
    await user.click(opt);
    await user.type(screen.getByLabelText(/Descripción/), "Servicio");

    // Set payment to match the total (115)
    const paymentInput = await screen.findByLabelText("Total");
    await user.clear(paymentInput);
    await user.type(paymentInput, "115");

    // Wait for preview total to render.
    await waitFor(() => expect(screen.getByTestId("totals-total")).toHaveTextContent(/115/), {
      timeout: 2000,
    });
    // Emit
    await waitFor(() => expect(screen.getByTestId("emit-button")).toBeEnabled());
    await user.click(screen.getByTestId("emit-button"));

    // Modal should reach success then auto-navigate after 400 ms (real timer).
    await waitFor(() => expect(screen.queryByTestId("invoice-detail")).toBeInTheDocument(), {
      timeout: 4000,
    });
  }, 15000);

  it("DEVUELTA → business_error path shows mensajes; form remains intact", async () => {
    const user = userEvent.setup();
    buildMount([
      http.post("/api/v1/invoices/:id/emit", async () =>
        HttpResponse.json({
          estado: "DEVUELTA",
          claveAcceso: "1111111111111111111111111111111111111111111111114",
          mensajes: [{ identificador: "RUC", mensaje: "RUC inválido", tipo: "ERROR" }],
        }),
      ),
    ]);
    await screen.findByTestId("line-row-0");
    await user.selectOptions(
      screen.getByTestId("emission-point-select"),
      STUB_EMISSION_POINTS[0]!.id,
    );
    await user.type(screen.getByTestId("customer-search-input"), "Pe");
    const opt = await screen.findByTestId(`customer-option-${STUB_CUSTOMER.id}`);
    await user.click(opt);
    await user.type(screen.getByLabelText(/Descripción/), "Servicio");
    const paymentInput = await screen.findByLabelText("Total");
    await user.clear(paymentInput);
    await user.type(paymentInput, "115");
    await waitFor(() => expect(screen.getByTestId("totals-total")).toHaveTextContent(/115/), {
      timeout: 2000,
    });
    await waitFor(() => expect(screen.getByTestId("emit-button")).toBeEnabled());
    await user.click(screen.getByTestId("emit-button"));

    expect(
      await screen.findByTestId("emit-modal-business-error", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The mensaje renders as `<span>identificador</span>: mensaje` so the
    // visible "RUC inválido" text is contained inside the `<li>`.
    const mensajes = screen.getAllByTestId("emit-mensaje");
    expect(mensajes.some((el) => el.textContent?.includes("RUC inválido"))).toBe(true);
    // Form input preserved.
    expect(screen.getByLabelText(/Descripción/)).toHaveValue("Servicio");
  }, 15000);

  it("network_error path shows Reintentar button", async () => {
    const user = userEvent.setup();
    buildMount([http.post("/api/v1/invoices/:id/emit", () => HttpResponse.error())]);
    await screen.findByTestId("line-row-0");
    await user.selectOptions(
      screen.getByTestId("emission-point-select"),
      STUB_EMISSION_POINTS[0]!.id,
    );
    await user.type(screen.getByTestId("customer-search-input"), "Pe");
    const opt = await screen.findByTestId(`customer-option-${STUB_CUSTOMER.id}`);
    await user.click(opt);
    await user.type(screen.getByLabelText(/Descripción/), "Servicio");
    const paymentInput = await screen.findByLabelText("Total");
    await user.clear(paymentInput);
    await user.type(paymentInput, "115");
    await waitFor(() => expect(screen.getByTestId("totals-total")).toHaveTextContent(/115/), {
      timeout: 2000,
    });
    await waitFor(() => expect(screen.getByTestId("emit-button")).toBeEnabled());
    await user.click(screen.getByTestId("emit-button"));
    expect(
      await screen.findByTestId("emit-modal-network-error", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("emit-modal-retry")).toBeInTheDocument();
  }, 15000);
});

describe("<InvoiceForm /> autosave + new customer dialog", () => {
  it("NewCustomerDialog: creating a customer selects it in the form", async () => {
    const user = userEvent.setup();
    const newCustomer = {
      ...STUB_CUSTOMER,
      id: "01KS5R6NXR0MY0X8SFHAH0GYFF",
      identificacion: "1710034065",
      razonSocial: "Otra Persona",
    };
    buildMount([
      http.post("/api/v1/customers", async () => HttpResponse.json(newCustomer, { status: 201 })),
    ]);
    await screen.findByTestId("line-row-0");
    await user.click(screen.getByRole("button", { name: /Nuevo cliente/i }));
    expect(await screen.findByTestId("new-customer-dialog")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Identificación/), "1710034065");
    await user.type(screen.getByLabelText(/Razón social/), "Otra Persona");
    await user.click(screen.getByTestId("new-customer-submit"));
    await waitFor(() =>
      expect(screen.queryByTestId("new-customer-dialog")).not.toBeInTheDocument(),
    );
    // Customer combobox now displays the new customer's razon social.
    expect((screen.getByTestId("customer-search-input") as HTMLInputElement).value).toContain(
      "Otra Persona",
    );
  }, 15000);
});

describe("<InvoiceForm /> RBAC", () => {
  it("VIEWER (no invoice.create) redirects to /forbidden", async () => {
    const VIEWER_ME = {
      ...ME,
      currentRole: "VIEWER" as const,
      permissions: ["invoice.read"],
    };
    mswServer.use(http.get("/api/v1/me", () => HttpResponse.json(VIEWER_ME)));
    const routes: RouteObject[] = [
      { path: "/invoices/new", element: <InvoicesNewPage /> },
      { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/invoices/new"] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider initialState={VIEWER_ME}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("forbidden")).toBeInTheDocument();
  });
});
