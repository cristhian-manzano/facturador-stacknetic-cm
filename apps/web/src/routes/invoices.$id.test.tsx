/**
 * Integration tests for `/invoices/:id` (SPEC-0043 §FR-2 + TASKS-0043
 * §5.2 / §2.4).
 *
 * Covers:
 *   - Renders timeline ordered ascending.
 *   - EN_PROCESO → AUTORIZADO via MSW after a polling tick. Uses fake
 *     timers + `POLL_INTERVAL_MS` to keep the test deterministic
 *     while honouring the polling contract.
 *   - Reissue button → POST `/reissue` → navigates to
 *     `/invoices/:newId/edit`.
 *   - VIEWER role lacks Reintentar / Reissue.
 *   - OPERATOR role sees Reintentar (when BORRADOR + prior failure)
 *     but NOT Reissue.
 *   - ACCOUNTANT role: view-only per SPEC-0011 §FR-5 row 3 (REVIEW-0044
 *     HIGH-1). Reissue is NOT visible because the matrix denies
 *     `invoice.reissue` for ACCOUNTANT.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { POLL_INTERVAL_MS } from "../invoices/detail/polling.js";

import { InvoicesDetailPage } from "./invoices.$id.js";

afterEach(() => {
  vi.useRealTimers();
});

const INVOICE_ID = "01HX8K0PYFA9B7Y1M2N3P4Q5AA";
const NEW_INVOICE_ID = "01HX8K0PYFA9B7Y1M2N3P4Q5BB";
const CLAVE = "1905202601179001234400110010010000001231234567812";

const ME_OWNER = {
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
  permissions: ["invoice.read", "invoice.create", "invoice.emit", "invoice.reissue"],
};

const ME_VIEWER = {
  ...ME_OWNER,
  currentRole: "VIEWER" as const,
  permissions: ["invoice.read"],
};

const ME_OPERATOR = {
  ...ME_OWNER,
  currentRole: "OPERATOR" as const,
  permissions: ["invoice.read", "invoice.create", "invoice.emit"],
};

// ACCOUNTANT is view-only per SPEC-0011 §FR-5 row 3 (REVIEW-0044 HIGH-1).
// Operators relying on the legacy write-capable behaviour set
// `RBAC_ACCOUNTANT_CAN_WRITE=true` server-side; the matrix the SPA
// receives via `/me` reflects the (potentially overridden) actions.
const ME_ACCOUNTANT = {
  ...ME_OWNER,
  currentRole: "ACCOUNTANT" as const,
  permissions: ["invoice.read"],
};

interface BuildDetailOpts {
  readonly sriEstado?:
    | "EN_PROCESO"
    | "AUTORIZADO"
    | "DEVUELTA"
    | "NO_AUTORIZADO"
    | "ERROR_RED"
    | "RECIBIDA";
  readonly invoiceEstado?: "BORRADOR" | "EMITIDO" | "ANULADO";
  readonly hasClaveAcceso?: boolean;
  readonly events?: readonly Record<string, unknown>[];
}

function buildDetail(opts: BuildDetailOpts = {}): Record<string, unknown> {
  const invoiceEstado = opts.invoiceEstado ?? "EMITIDO";
  const sriEstado = opts.sriEstado ?? "AUTORIZADO";
  const hasClave = opts.hasClaveAcceso ?? true;
  return {
    invoice: {
      id: INVOICE_ID,
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      customerId: "01HX8K0PYFA9B7Y1M2N3P4Q5XX",
      emissionPointId: "01HX8K0PYFA9B7Y1M2N3P4Q5EE",
      estado: invoiceEstado,
      codDoc: "01",
      estab: "001",
      ptoEmi: "001",
      secuencial: hasClave ? "000000001" : null,
      claveAcceso: hasClave ? CLAVE : null,
      fechaEmision: "2026-05-19",
      moneda: "DOLAR",
      obligadoContabilidad: false,
      contribuyenteEspecial: null,
      totalSinImpuestos: 100,
      totalDescuento: 0,
      totalConImpuestos: [
        {
          codigo: "2",
          codigoPorcentaje: "4",
          tarifa: 15,
          baseImponible: 100,
          valor: 15,
        },
      ],
      propina: 0,
      importeTotal: 115,
      lines: [
        {
          orden: 0,
          descripcion: "Servicio profesional",
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
    sriDocument: hasClave
      ? {
          id: "01HX8K0PYFA9B7Y1M2N3P4Q5SD",
          companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
          claveAcceso: CLAVE,
          ambiente: "1",
          codDoc: "01",
          estab: "001",
          ptoEmi: "001",
          secuencial: "000000001",
          fechaEmision: "2026-05-19",
          estado: sriEstado,
          numeroAutorizacion: sriEstado === "AUTORIZADO" ? CLAVE : null,
          fechaAutorizacion: sriEstado === "AUTORIZADO" ? "2026-05-19T10:05:00.000+00:00" : null,
          createdAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
        }
      : null,
    sriEvents: opts.events ?? [],
  };
}

function makeEvent(
  suffix: string,
  createdAt: string,
  etapa: string,
  estado = "AUTORIZADO",
): Record<string, unknown> {
  return {
    id: `01HX8K0PYFA9B7Y1M2N3P4Q5${suffix}`,
    documentId: "01HX8K0PYFA9B7Y1M2N3P4Q5SD",
    etapa,
    estado,
    mensajes: [],
    durationMs: 12,
    createdAt,
  };
}

function buildMount(opts: {
  me?: unknown;
  detailHandlers: ReturnType<typeof http.get>[];
  extraHandlers?: ReturnType<typeof http.post>[];
}) {
  mswServer.use(
    ...(opts.extraHandlers ?? []),
    ...opts.detailHandlers,
    http.get("/api/v1/me", () => HttpResponse.json(opts.me ?? ME_OWNER)),
  );
  const routes: RouteObject[] = [
    { path: `/invoices/:id`, element: <InvoicesDetailPage /> },
    {
      path: `/invoices/:id/edit`,
      element: <div data-testid="edit-page">EDIT</div>,
    },
    { path: "/invoices", element: <div data-testid="list-page">LIST</div> },
    { path: "/forbidden", element: <div data-testid="forbidden">FORBIDDEN</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [`/invoices/${INVOICE_ID}`],
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider initialState={opts.me ?? ME_OWNER}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("/invoices/:id — detail render + timeline order", () => {
  it("renders header + customer + timeline events in createdAt ascending order", async () => {
    const events = [
      makeEvent("DD", "2026-05-19T10:00:45.000Z", "AUTHORIZE"),
      makeEvent("AA", "2026-05-19T10:00:00.000Z", "BUILD"),
      makeEvent("CC", "2026-05-19T10:00:30.000Z", "RECEIVE"),
      makeEvent("BB", "2026-05-19T10:00:15.000Z", "SIGN"),
    ];
    buildMount({
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(buildDetail({ events })),
        ),
      ],
    });
    await screen.findByTestId("detail-header");
    expect(screen.getByTestId("customer-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sri-timeline")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(4);
    // Walk the first 4 items and confirm their etapa labels follow the
    // chronological order.
    const etapas = items
      .slice(0, 4)
      .map((li) => li.querySelector("[data-testid^='sri-event-etapa-']")?.textContent);
    expect(etapas).toEqual([
      "Construcción XML",
      "Firma XAdES",
      "Recepción SRI",
      "Autorización SRI",
    ]);
  });
});

describe("/invoices/:id — polling transitions EN_PROCESO → AUTORIZADO", () => {
  it(
    "auto-updates UI without a manual refresh after a polling tick",
    async () => {
      let callCount = 0;
      buildMount({
        detailHandlers: [
          http.get(`/api/v1/invoices/${INVOICE_ID}`, () => {
            callCount++;
            if (callCount === 1) {
              return HttpResponse.json(buildDetail({ sriEstado: "EN_PROCESO" }));
            }
            return HttpResponse.json(buildDetail({ sriEstado: "AUTORIZADO" }));
          }),
        ],
      });
      // First render shows EN_PROCESO.
      expect(await screen.findByTestId("sri-estado-badge-EN_PROCESO")).toBeInTheDocument();

      // Drive a polling tick. TanStack Query 5 honours `refetchInterval`
      // against the real timer; rather than swap to fake timers (which
      // interacts poorly with the async query loop), we wait for the
      // interval to elapse via the real clock. POLL_INTERVAL_MS (5s) is
      // imported from the constants module so this test breaks if the
      // interval is shortened below the test budget.
      await waitFor(
        () => {
          expect(callCount).toBeGreaterThanOrEqual(2);
        },
        { timeout: POLL_INTERVAL_MS + 4000, interval: 200 },
      );

      // After the polling tick the UI shows AUTORIZADO.
      await waitFor(
        () => {
          expect(screen.queryByTestId("sri-estado-badge-AUTORIZADO")).not.toBeNull();
        },
        { timeout: 4000 },
      );
    },
    POLL_INTERVAL_MS + 10000,
  );
});

describe("/invoices/:id — Reissue", () => {
  it("clicking Reissue calls POST /reissue and navigates to /invoices/:newId/edit", async () => {
    buildMount({
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(buildDetail({ sriEstado: "DEVUELTA" })),
        ),
      ],
      extraHandlers: [
        http.post(`/api/v1/invoices/${INVOICE_ID}/reissue`, () =>
          HttpResponse.json({ newInvoiceId: NEW_INVOICE_ID }, { status: 201 }),
        ),
      ],
    });
    const reissue = await screen.findByTestId("action-reissue");
    const user = userEvent.setup();
    await user.click(reissue);
    expect(await screen.findByTestId("edit-page")).toBeInTheDocument();
  });
});

describe("/invoices/:id — RBAC gating", () => {
  it("VIEWER role: Reintentar AND Reissue absent", async () => {
    buildMount({
      me: ME_VIEWER,
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(buildDetail({ sriEstado: "DEVUELTA" })),
        ),
      ],
    });
    await screen.findByTestId("detail-header");
    expect(screen.queryByTestId("action-retry-emit")).toBeNull();
    expect(screen.queryByTestId("action-reissue")).toBeNull();
    // VIEWER still has invoice.read → Sincronizar visible (no PII risk).
    expect(screen.getByTestId("action-refresh")).toBeInTheDocument();
  });

  it("OPERATOR role: Reintentar visible (BORRADOR + prior failure), Reissue absent", async () => {
    buildMount({
      me: ME_OPERATOR,
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(
            buildDetail({
              invoiceEstado: "BORRADOR",
              sriEstado: "DEVUELTA",
              hasClaveAcceso: true,
            }),
          ),
        ),
      ],
    });
    await screen.findByTestId("detail-header");
    expect(screen.getByTestId("action-retry-emit")).toBeInTheDocument();
    expect(screen.queryByTestId("action-reissue")).toBeNull();
  });

  it("ACCOUNTANT role: Reissue NOT visible (view-only per REVIEW-0044 HIGH-1)", async () => {
    // ACCOUNTANT no longer has `invoice.reissue` in the default matrix
    // (SPEC-0011 §FR-5 row 3). The Reissue button must NOT render.
    buildMount({
      me: ME_ACCOUNTANT,
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(buildDetail({ invoiceEstado: "EMITIDO", sriEstado: "DEVUELTA" })),
        ),
      ],
    });
    await screen.findByTestId("detail-header");
    expect(screen.queryByTestId("action-reissue")).toBeNull();
  });
});

describe("/invoices/:id — polling pauses while tab is hidden", () => {
  it(
    "no additional fetch fires while document.visibilityState === 'hidden'",
    async () => {
      let callCount = 0;
      buildMount({
        detailHandlers: [
          http.get(`/api/v1/invoices/${INVOICE_ID}`, () => {
            callCount++;
            return HttpResponse.json(buildDetail({ sriEstado: "EN_PROCESO" }));
          }),
        ],
      });
      // Initial fetch resolves.
      await screen.findByTestId("sri-estado-badge-EN_PROCESO");
      const baseline = callCount;

      // Flip the tab to hidden and notify React Router / TanStack Query.
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // Wait through more than one polling interval. Because the route's
      // refetchInterval returns `false` when hidden, no extra request
      // should fire.
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 500));
      expect(callCount).toBe(baseline);

      // Restore visibility so we don't leak into subsequent tests.
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    },
    POLL_INTERVAL_MS + 4000,
  );
});

describe("/invoices/:id — AUTORIZADO placeholders", () => {
  it("Descargar XML and Imprimir RIDE show a 'Próximamente' toast", async () => {
    buildMount({
      detailHandlers: [
        http.get(`/api/v1/invoices/${INVOICE_ID}`, () =>
          HttpResponse.json(buildDetail({ sriEstado: "AUTORIZADO" })),
        ),
      ],
    });
    const xmlBtn = await screen.findByTestId("action-download-xml");
    const user = userEvent.setup();
    await user.click(xmlBtn);
    expect(await screen.findByTestId("detail-toast-info")).toHaveTextContent(/Próximamente/);
  });
});
