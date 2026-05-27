/**
 * `TenantSwitcher` — topbar dropdown that lets users change active tenant
 * (SPEC-0041 §FR-3 / TASKS-0041 §2.2).
 *
 * Anatomy:
 *
 *   ┌───────────────────────────────────┐
 *   │ [▼ Empresa activa] ◀ chip button   │
 *   └───────────────────────────────────┘
 *         │ on click
 *         ▼
 *   ┌──────────────────────┐
 *   │ ✓ ACME S.A.   (OWNER) │   ← current
 *   │   STUB S.A.   (VIEWER)│
 *   │   …                   │
 *   └──────────────────────┘
 *
 * Behaviour:
 *   - Clicking the chip toggles a panel that lists every membership.
 *   - Clicking a non-current option:
 *       1. POST `/api/v1/session/tenant { companyId }`.
 *       2. `queryClient.clear()` — wipes tenant-scoped caches.
 *       3. `auth.refresh()` — reloads `/me` so the topbar reflects the new
 *          tenant.
 *       4. Closes the panel.
 *   - Clicking the current option (or outside) just closes the panel.
 *   - The Esc key closes the panel.
 *
 * Why we render NOTHING when memberships.length < 2:
 *   - A single-tenant user has nothing to switch to; rendering the chip
 *     anyway just creates dead UI.
 *   - The current-tenant chip in `AppLayout` already shows the active
 *     company name; the switcher is purely for navigation.
 *
 * Accessibility:
 *   - `<details>`/`<summary>` would work but a typed `aria-expanded` button
 *     keeps full control over focus / keyboard.
 *   - Panel uses `role="menu"` + options use `role="menuitem"`.
 *   - The "current" tenant is announced via `aria-checked` so a screen
 *     reader user knows the option is the active one.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { useAuth } from "../auth/context.js";
import { switchActiveTenant } from "../auth/tenant-api.js";
import { t } from "../i18n/es.js";
import { cn } from "../lib/cn.js";

export interface TenantSwitcherProps {
  /** Optional extra className for the trigger button. */
  className?: string;
}

export function TenantSwitcher({ className }: TenantSwitcherProps): ReactElement | null {
  const { memberships, currentCompanyId, refresh } = useAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentMembership = memberships.find((m) => m.companyId === currentCompanyId);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (containerRef.current?.contains(event.target) === false) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onSelect = useCallback(
    async (companyId: string): Promise<void> => {
      if (companyId === currentCompanyId) {
        setOpen(false);
        return;
      }
      setError(null);
      setPendingId(companyId);
      try {
        await switchActiveTenant(companyId, {
          queryClient,
          onAfter: () => refresh(),
        });
        setOpen(false);
      } catch {
        setError(t("auth.tenantSelect.switchError"));
      } finally {
        setPendingId(null);
      }
    },
    [currentCompanyId, queryClient, refresh],
  );

  // Don't render when there's nothing to switch to.
  if (memberships.length < 2) return null;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("auth.tenantSwitcher.label")}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        data-testid="tenant-switcher-trigger"
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <span className="font-medium">
          {currentMembership?.razonSocial ?? t("nav.tenant.placeholder")}
        </span>
        <span aria-hidden="true" className="text-xs text-slate-500">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("auth.tenantSwitcher.label")}
          data-testid="tenant-switcher-panel"
          className="absolute right-0 z-10 mt-2 w-72 rounded border border-slate-200 bg-white shadow-lg"
        >
          {error !== null && (
            <div
              role="alert"
              className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {error}
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {memberships.map((m) => {
              const isCurrent = m.companyId === currentCompanyId;
              const isBusy = pendingId === m.companyId;
              return (
                <li key={m.companyId}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    aria-busy={isBusy}
                    disabled={pendingId !== null}
                    onClick={() => void onSelect(m.companyId)}
                    data-testid={`tenant-switcher-option-${m.companyId}`}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                      isCurrent
                        ? "bg-primary-50 text-primary-800"
                        : "text-slate-700 hover:bg-slate-50",
                      pendingId !== null && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {isCurrent && (
                        <span aria-hidden="true" className="text-primary-600">
                          ✓
                        </span>
                      )}
                      <span className="font-medium">{m.razonSocial}</span>
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
                      {m.role}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
