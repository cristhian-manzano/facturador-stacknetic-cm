/**
 * `AuthContext` integration tests (TASKS-0040 §6.2).
 *
 * Drives the provider against MSW-stubbed `/me` responses:
 *   - 200 with a valid MeResponse → status becomes "ready", exposes user
 *     + memberships + permissions.
 *   - 401 → status becomes "unauthenticated"; downstream guards redirect.
 *   - auth:401 event dispatched after mount → state clears.
 */
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { ReactElement } from "react";

import { mswServer } from "../../test/msw/server.js";
import { AUTH_EVENT_UNAUTHORIZED } from "../lib/api.js";
import { AuthProvider, useAuth } from "./context.js";

function Probe(): ReactElement {
  const { status, user, memberships, currentCompanyId, permissions } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user-email">{user?.email ?? ""}</span>
      <span data-testid="membership-count">{String(memberships.length)}</span>
      <span data-testid="company">{currentCompanyId ?? ""}</span>
      <span data-testid="permissions-count">{String(permissions.length)}</span>
    </div>
  );
}

const ME_OK = {
  user: {
    id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
    email: "alice@facturador.test",
    displayName: "Alice Stub",
  },
  memberships: [
    {
      companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
      razonSocial: "STUB TENANT S.A.",
      role: "OWNER" as const,
    },
  ],
  activeCompanyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  currentRole: "OWNER" as const,
  permissions: ["invoice.read", "invoice.create", "customer.read", "tenant.read"],
};

describe("AuthProvider", () => {
  it("transitions loading → ready with /me payload", async () => {
    mswServer.use(http.get("/api/v1/me", () => HttpResponse.json(ME_OK)));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // First render: loading.
    expect(screen.getByTestId("status").textContent).toBe("loading");

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("ready");
    });

    expect(screen.getByTestId("user-email").textContent).toBe("alice@facturador.test");
    expect(screen.getByTestId("membership-count").textContent).toBe("1");
    expect(screen.getByTestId("company").textContent).toBe("01KS5R6NXR0MY0X8SFHAH0GYHT");
    expect(Number(screen.getByTestId("permissions-count").textContent)).toBeGreaterThan(0);
  });

  it("transitions loading → unauthenticated on 401", async () => {
    mswServer.use(
      http.get("/api/v1/me", () =>
        HttpResponse.json(
          { title: "Unauthenticated", status: 401, code: "auth.unauthorized" },
          { status: 401 },
        ),
      ),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    });
    expect(screen.getByTestId("user-email").textContent).toBe("");
  });

  it("transitions loading → error on 500", async () => {
    mswServer.use(
      http.get("/api/v1/me", () =>
        HttpResponse.json(
          { title: "Internal", status: 500, code: "internal.unexpected" },
          { status: 500 },
        ),
      ),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("error");
    });
  });

  it("clears state when an auth:401 event fires after mount", async () => {
    mswServer.use(http.get("/api/v1/me", () => HttpResponse.json(ME_OK)));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("ready");
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT_UNAUTHORIZED));
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    });
    expect(screen.getByTestId("user-email").textContent).toBe("");
  });

  it("supports initialState seam for tests (skips /me fetch)", () => {
    render(
      <AuthProvider initialState={ME_OK}>
        <Probe />
      </AuthProvider>,
    );

    // No waiting required: seeded synchronously.
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("user-email").textContent).toBe("alice@facturador.test");
  });

  it("seeds unauthenticated when initialState=null", () => {
    render(
      <AuthProvider initialState={null}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
  });
});
