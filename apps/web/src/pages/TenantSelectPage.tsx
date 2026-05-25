/**
 * `TenantSelectPage` — interactive tenant picker (SPEC-0041 §6 / TASKS-0041 §2.1).
 *
 * Rendered:
 *   - When `RequireAuth` redirects a ready-but-no-tenant user here.
 *   - When the user navigates to `/tenants/select` directly (link from the
 *     tenant switcher when they want to change tenants).
 *
 * Behaviour:
 *   - Lists `useAuth().memberships` sorted alphabetically by `razonSocial`.
 *   - Each membership shows the company name + role chip.
 *   - Click → POST `/api/v1/session/tenant { companyId }`, then
 *     `queryClient.clear()` + `auth.refresh()` (delegated to
 *     `switchActiveTenant`).
 *   - On success: navigate to `/`. `RequireAuth` lets the user through once
 *     `currentCompanyId` is set.
 *   - On failure: surface a brief banner + leave the user on the page to
 *     retry.
 *
 * Accessibility:
 *   - Buttons (not links) so screen readers describe the action.
 *   - Each button labelled with the company name + role.
 *   - Banner uses `role="alert"`.
 */
import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../auth/context.js";
import { ApiError } from "../lib/api.js";
import { switchActiveTenant } from "../auth/tenant-api.js";
import { t } from "../i18n/es.js";

export function TenantSelectPage(): ReactElement {
  const { memberships, refresh } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Alphabetical so the order is predictable across sessions; the server
  // doesn't enforce an order so we own the UX.
  const sorted = [...memberships].sort((a, b) =>
    a.razonSocial.localeCompare(b.razonSocial, "es", { sensitivity: "base" }),
  );

  const handleSelect = async (companyId: string): Promise<void> => {
    if (pendingId !== null) return;
    setError(null);
    setPendingId(companyId);
    try {
      await switchActiveTenant(companyId, {
        queryClient,
        onAfter: () => refresh(),
      });
      navigate("/", { replace: true });
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? t("auth.tenantSelect.switchError")
          : t("auth.tenantSelect.switchError");
      setError(message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <main className="container mx-auto max-w-lg py-16">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">{t("auth.tenantSelect.title")}</h1>
        <p className="text-sm text-slate-600">{t("auth.tenantSelect.lead")}</p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="tenant-select-error"
          className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {t("auth.tenantSelect.empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="tenant-list">
          {sorted.map((m) => {
            const busy = pendingId === m.companyId;
            return (
              <li key={m.companyId}>
                <button
                  type="button"
                  disabled={pendingId !== null}
                  aria-busy={busy}
                  onClick={() => void handleSelect(m.companyId)}
                  data-testid={`tenant-option-${m.companyId}`}
                  className="flex w-full items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-slate-900">{m.razonSocial}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
                    {m.role}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
