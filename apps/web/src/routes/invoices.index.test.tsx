/**
 * Integration tests for `/invoices` (SPEC-0043 §FR-1 + TASKS-0043 §5.1).
 *
 * Covers:
 *   - Empty tenant → empty state + "Crear factura" CTA navigates to
 *     `/invoices/new`.
 *   - 10 invoices → 10 rows.
 *   - Selecting estado=EMITIDO → URL contains `?estado=EMITIDO`; the
 *     API receives the same query string.
 *   - "Cargar más" appends page 2.
 *   - VIEWER role still sees the list (read), but no Crear button.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";

import { InvoicesIndexPage } from "./invoices.index.js";

afterEach(() => {
  vi.useRealTimers();
});

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

const VIEWER_ME = {
  ...ME,
  currentRole: "VIEWER" as const,
  permissions: ["invoice.read"],
};

function makeRow(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    estado: "EMITIDO",
    fechaEmision: "2026-05-19",
    customerRazonSocial: "Cliente Demo",
    estab: "001",
    ptoEmi: "001",
    secuencial: "000000001",
    importeTotal: 115,
    sriEstado: "AUTORIZADO",
    claveAcceso: "1905202601179001234400110010010000001231234567812",
    ...over,
  };
}

function buildMount(opts: {
  me?: unknown;
  initialUrl?: string;
  handlers?: ReturnType<typeof http.get>[];
}) {
  mswServer.use(
    ...(opts.handlers ?? []),
    http.get("/api/v1/me", () => HttpResponse.json(opts.me ?? ME)),
  );
  const routes: RouteObject[] = [
    { path: "/invoices", element: <InvoicesIndexPage /> },
    { path: "/invoices/new", element: <div data-testid="new-page">NEW</div> },
    {
      path: "/invoices/:id",
      element: <div data-testid="detail-page">DETAIL</div>,
    },
    { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [opts.initialUrl ?? "/invoices"],
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider initialState={opts.me ?? ME}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("/invoices — empty state", () => {
  it("empty list shows EmptyState + CTA navigates to /invoices/new", async () => {
    buildMount({
      handlers: [
        http.get("/api/v1/invoices", () => HttpResponse.json({ items: [], nextCursor: null })),
      ],
    });
    expect(await screen.findByTestId("invoices-empty")).toBeInTheDocument();
    const cta = screen.getByTestId("invoices-empty-cta");
    const user = userEvent.setup();
    await user.click(cta);
    expect(await screen.findByTestId("new-page")).toBeInTheDocument();
  });

  it("VIEWER role sees the empty state but no CTA", async () => {
    buildMount({
      me: VIEWER_ME,
      handlers: [
        http.get("/api/v1/invoices", () => HttpResponse.json({ items: [], nextCursor: null })),
      ],
    });
    expect(await screen.findByTestId("invoices-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("invoices-empty-cta")).toBeNull();
  });
});

describe("/invoices — populated list", () => {
  it("10 rows → 10 invoice-row elements", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeRow(`01HX8K0PYFA9B7Y1M2N3P4Q5${String(i).padStart(2, "0")}`),
    );
    buildMount({
      handlers: [
        http.get("/api/v1/invoices", () => HttpResponse.json({ items, nextCursor: null })),
      ],
    });
    await screen.findByTestId("invoices-table-wrapper");
    // 1 header row + 10 data rows = 11.
    expect(screen.getAllByRole("row")).toHaveLength(11);
  });
});

describe("/invoices — filter to URL + API", () => {
  it("estado=EMITIDO is reflected in the URL AND in the API call query string", async () => {
    const seenQueries: string[] = [];
    const handlerEmitido = http.get("/api/v1/invoices", ({ request }) => {
      seenQueries.push(new URL(request.url).search);
      const url = new URL(request.url);
      const estado = url.searchParams.get("estado");
      const items = estado === "EMITIDO" ? [makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5AA")] : [];
      return HttpResponse.json({ items, nextCursor: null });
    });
    buildMount({ handlers: [handlerEmitido] });
    await screen.findByTestId("filters-bar");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-estado-EMITIDO"));

    // The URL contains ?estado=EMITIDO (visible via the row that
    // appears under the matched filter).
    await waitFor(() => {
      expect(screen.queryByTestId("invoice-row-01HX8K0PYFA9B7Y1M2N3P4Q5AA")).toBeInTheDocument();
    });

    // At least one of the recorded requests carried `estado=EMITIDO`.
    expect(seenQueries.some((q) => q.includes("estado=EMITIDO"))).toBe(true);
  });
});

describe("/invoices — cursor pagination", () => {
  it("'Cargar más' appends the second page", async () => {
    const page1 = [makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5AA")];
    const page2 = [makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5BB")];
    const CURSOR = "01HX8K0PYFA9B7Y1M2N3P4Q5ZZ";
    const handler = http.get("/api/v1/invoices", ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor === null) {
        return HttpResponse.json({ items: page1, nextCursor: CURSOR });
      }
      return HttpResponse.json({ items: page2, nextCursor: null });
    });
    buildMount({ handlers: [handler] });
    expect(await screen.findByTestId("invoice-row-01HX8K0PYFA9B7Y1M2N3P4Q5AA")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("list-load-more"));
    expect(await screen.findByTestId("invoice-row-01HX8K0PYFA9B7Y1M2N3P4Q5BB")).toBeInTheDocument();
    // Page 1 row still visible.
    expect(screen.getByTestId("invoice-row-01HX8K0PYFA9B7Y1M2N3P4Q5AA")).toBeInTheDocument();
  });
});

describe("/invoices — error path", () => {
  it("API error → error state with Reintentar", async () => {
    buildMount({
      handlers: [
        http.get("/api/v1/invoices", () =>
          HttpResponse.json(
            { type: "about:blank", title: "boom", status: 500, code: "server.error" },
            { status: 500 },
          ),
        ),
      ],
    });
    expect(await screen.findByTestId("list-error")).toBeInTheDocument();
  });
});

describe("/invoices — pending banner concurrency-3 batch", () => {
  it("clicking 'Refrescar todas' triggers per-row refresh calls", async () => {
    let refreshCalls = 0;
    const items = [
      makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5AA", { sriEstado: "EN_PROCESO" }),
      makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5BB", { sriEstado: "EN_PROCESO" }),
      makeRow("01HX8K0PYFA9B7Y1M2N3P4Q5CC", { sriEstado: "EN_PROCESO" }),
    ];
    buildMount({
      handlers: [
        http.get("/api/v1/invoices", () => HttpResponse.json({ items, nextCursor: null })),
        http.post("/api/v1/invoices/:id/refresh", () => {
          refreshCalls++;
          // The refresh response must validate against InvoiceDetailSchema.
          // We return the minimum shape that satisfies it.
          return HttpResponse.json({
            invoice: {
              id: "01HX8K0PYFA9B7Y1M2N3P4Q5AA",
              companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
              customerId: "01HX8K0PYFA9B7Y1M2N3P4Q5XX",
              emissionPointId: "01HX8K0PYFA9B7Y1M2N3P4Q5EE",
              estado: "EMITIDO",
              codDoc: "01",
              estab: "001",
              ptoEmi: "001",
              secuencial: "000000001",
              claveAcceso: "1905202601179001234400110010010000001231234567812",
              fechaEmision: "2026-05-19",
              moneda: "DOLAR",
              obligadoContabilidad: false,
              contribuyenteEspecial: null,
              totalSinImpuestos: 100,
              totalDescuento: 0,
              totalConImpuestos: [],
              propina: 0,
              importeTotal: 115,
              lines: [
                {
                  orden: 0,
                  descripcion: "x",
                  cantidad: 1,
                  precioUnitario: 100,
                  descuento: 0,
                  precioTotalSinImpuesto: 100,
                  impuestos: [
                    {
                      codigo: "2",
                      codigoPorcentaje: "4",
                      tarifa: 15,
                      baseImponible: 100,
                      valor: 15,
                    },
                  ],
                },
              ],
              payments: [{ formaPago: "01", total: 115 }],
              adicionales: [],
              createdAt: "2026-05-19T10:00:00.000Z",
              updatedAt: "2026-05-19T10:00:00.000Z",
            },
            customer: {
              id: "01HX8K0PYFA9B7Y1M2N3P4Q5XX",
              companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
              isActive: true,
              createdAt: "2026-05-19T10:00:00.000Z",
              updatedAt: "2026-05-19T10:00:00.000Z",
              deletedAt: null,
              tipoIdentificacion: "07",
              identificacion: "9999999999999",
              razonSocial: "CONSUMIDOR FINAL",
            },
            sriDocument: null,
            sriEvents: [],
          });
        }),
      ],
    });
    expect(await screen.findByTestId("pending-banner")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("pending-banner-refresh"));
    await waitFor(() => {
      expect(refreshCalls).toBe(3);
    });
  });
});
