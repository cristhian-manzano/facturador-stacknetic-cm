/**
 * `LoginPage` tests (TASKS-0041 §5.1).
 *
 * Coverage matrix:
 *   - 200 happy path → navigates to sanitised `?next` (default `/`).
 *   - 401 → generic banner "Credenciales inválidas"; NO email-existence
 *     hint (assertion on the absence of trigger words).
 *   - 429 → throttle banner with retry hint.
 *   - 400 with `errors=[{identificador:"email"...}]` → inline error under
 *     the email field.
 *   - Disabled-while-pending: submit button + inputs disable on submit.
 *   - Focus management: email field is focused on mount.
 *   - `?next=https://evil.com` → navigation falls back to `/`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { mswServer } from "../../test/msw/server.js";
import { AuthProvider } from "../auth/context.js";
import { LoginPage } from "./LoginPage.js";

const ME_PAYLOAD = {
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
  permissions: ["invoice.read"],
};

const LOGIN_RESPONSE = {
  user: ME_PAYLOAD.user,
  memberships: ME_PAYLOAD.memberships,
  activeCompanyId: ME_PAYLOAD.activeCompanyId,
  csrfToken: "fresh-csrf-token-32-bytes-min-length",
};

interface MountOptions {
  initialPath?: string;
}

function mount({ initialPath = "/login" }: MountOptions = {}) {
  const routes: RouteObject[] = [
    { path: "/login", element: <LoginPage /> },
    { path: "/", element: <div data-testid="home">HOME</div> },
    { path: "/dashboard", element: <div data-testid="dashboard">DASHBOARD</div> },
    {
      path: "/tenants/select",
      element: <div data-testid="tenant-select">TENANT SELECT</div>,
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialState={null}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Default `/me` handler so AuthProvider.refresh() resolves with our user
  // after a successful login. Individual tests override it where needed.
  mswServer.use(http.get("/api/v1/me", () => HttpResponse.json(ME_PAYLOAD)));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoginPage — happy path", () => {
  it("renders title, fields and a submit button", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("focuses the email field on mount", async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
    });
  });

  it("navigates to `/` on a successful 200 login (default ?next)", async () => {
    mswServer.use(http.post("/api/v1/auth/login", () => HttpResponse.json(LOGIN_RESPONSE)));
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });
  });

  it("navigates to the sanitised `?next` value on success", async () => {
    mswServer.use(http.post("/api/v1/auth/login", () => HttpResponse.json(LOGIN_RESPONSE)));
    mount({ initialPath: "/login?next=%2Fdashboard" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
  });

  it("ignores an open-redirect ?next (https://evil.com) and falls back to /", async () => {
    mswServer.use(http.post("/api/v1/auth/login", () => HttpResponse.json(LOGIN_RESPONSE)));
    mount({
      initialPath: `/login?next=${encodeURIComponent("https://evil.com")}`,
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("dashboard")).toBeNull();
  });
});

describe("LoginPage — failure paths", () => {
  it("shows the GENERIC banner on 401 and never reveals which field was wrong", async () => {
    mswServer.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            type: "urn:facturador:auth",
            title: "Credenciales inválidas",
            status: 401,
            code: "auth.invalid_credentials",
          },
          { status: 401 },
        ),
      ),
    );

    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    const banner = await screen.findByTestId("login-banner");
    expect(banner).toHaveTextContent("Credenciales inválidas");
    expect(banner).toHaveAttribute("data-banner-kind", "invalid");
    // Hard rule: no email-existence hints. The banner must NOT say things
    // like "usuario", "no existe", "correo no encontrado", "email no
    // registrado", "email" alone, "no encontrado", etc.
    const text = banner.textContent.toLowerCase();
    expect(text).not.toContain("usuario");
    expect(text).not.toContain("no existe");
    expect(text).not.toContain("no encontrado");
    expect(text).not.toContain("registrad");
  });

  it("shows the throttle banner on 429", async () => {
    mswServer.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            type: "urn:facturador:rate",
            title: "Too many requests",
            status: 429,
            code: "rate_limited",
          },
          { status: 429 },
        ),
      ),
    );

    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    const banner = await screen.findByTestId("login-banner");
    expect(banner).toHaveAttribute("data-banner-kind", "throttled");
    expect(banner).toHaveTextContent(/Demasiados intentos/i);
  });

  it("inline-displays field errors on 400 with errors[]", async () => {
    mswServer.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            type: "urn:facturador:validation",
            title: "Datos inválidos",
            status: 400,
            code: "validation.failed",
            errors: [{ identificador: "email", mensaje: "requerido", tipo: "ERROR" as const }],
          },
          { status: 400 },
        ),
      ),
    );

    mount();
    const user = userEvent.setup();
    // Type at least 8 chars in password to pass client validation and
    // reach the server. Type something plausible in email too (the server
    // is mocked to reject regardless).
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    // The inline error appears under the email field.
    await waitFor(() => {
      const errorEl = screen.getByText("requerido");
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveAttribute("id", "login-email-error");
    });
    // Email input flips aria-invalid.
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("LoginPage — UI affordances", () => {
  it("disables submit + inputs while the request is pending and shows a spinner label", async () => {
    mswServer.use(
      http.post("/api/v1/auth/login", async () => {
        await delay(60);
        return HttpResponse.json(LOGIN_RESPONSE);
      }),
    );

    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "alice@facturador.test");
    await user.type(screen.getByLabelText("Contraseña"), "passwordpassword");
    const submit = screen.getByTestId("login-submit");
    await user.click(submit);

    // While the MSW handler is delayed, the button is disabled + aria-busy.
    await waitFor(() => {
      expect(submit).toHaveAttribute("aria-busy", "true");
      expect(submit).toBeDisabled();
      expect(screen.getByLabelText("Correo electrónico")).toBeDisabled();
      expect(screen.getByLabelText("Contraseña")).toBeDisabled();
    });

    // Eventually resolves and navigates to /.
    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });
  });

  it("client-side validation blocks submit before any request is fired", async () => {
    const handler = vi.fn();
    mswServer.use(
      http.post("/api/v1/auth/login", () => {
        handler();
        return HttpResponse.json(LOGIN_RESPONSE);
      }),
    );

    mount();
    const user = userEvent.setup();
    // Submit without filling anything — RHF + zod should refuse the submit.
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    // At least one error message appears (RHF resolves zod issues async).
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
