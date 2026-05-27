/**
 * `AppLayout` — the chrome around every authenticated page
 * (SPEC-0040 §6.7 / PLAN-0040 §4 Phase 5 / TASKS-0040 §5).
 *
 * Anatomy:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Topbar: logo · tenant switcher · user menu (sign-out)    │
 *   ├──────────────┬───────────────────────────────────────────┤
 *   │ Sidebar      │ <Outlet /> — route-rendered content        │
 *   │  Inicio      │                                           │
 *   │  Facturas    │                                           │
 *   │  Clientes    │                                           │
 *   │  Establ.     │                                           │
 *   │  Configurac. │                                           │
 *   └──────────────┴───────────────────────────────────────────┘
 *
 * Per SPEC-0011 / TASKS-0040 §5.1, nav links are hidden when the caller
 * lacks the corresponding action in their `permissions` array. The
 * "Configuración" entry uses an OR-of-actions because it gates several
 * admin surfaces and we only need to show the link when any one of them
 * is reachable.
 *
 * Accessibility:
 *   - The skip-link is the first focusable element.
 *   - The sidebar uses `<nav aria-label="Principal">`.
 *   - The active route is marked with `aria-current="page"`.
 *
 * Security:
 *   - "Cerrar sesión" lives in `UserMenu` → `SignOutButton`; the button
 *     calls `signOut()` from the AuthContext (`apiFetch` honours CSRF)
 *     AND clears the TanStack Query cache before navigating to `/login`.
 *   - The tenant switcher (`TenantSwitcher`) rotates CSRF via the API
 *     and ALSO clears the cache (tenant-scoped data must not leak).
 */
import { useMemo, type ReactElement } from "react";
import { NavLink, Outlet } from "react-router-dom";

import type { Action } from "@facturador/utils/rbac";

import { useAuth } from "../auth/context.js";
import { t } from "../i18n/es.js";
import { cn } from "../lib/cn.js";

import { TenantSwitcher } from "./TenantSwitcher.js";
import { UserMenu } from "./UserMenu.js";

interface NavEntry {
  to: string;
  label: string;
  /** Permissions to OR together. Empty array == always visible. */
  permissions: readonly Action[];
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { to: "/", label: t("nav.home"), permissions: [] },
  { to: "/invoices", label: t("nav.invoices"), permissions: ["invoice.read"] },
  { to: "/customers", label: t("nav.customers"), permissions: ["customer.read"] },
  {
    to: "/establecimientos",
    label: t("nav.establecimientos"),
    permissions: ["establecimiento.manage"],
  },
  {
    to: "/settings",
    label: t("nav.settings"),
    permissions: ["tenant.update", "establecimiento.manage", "certificate.manage"],
  },
];

/** Show a nav entry only when the user holds at least one of its actions. */
function isVisible(entry: NavEntry, perms: readonly Action[]): boolean {
  if (entry.permissions.length === 0) return true;
  return entry.permissions.some((action) => perms.includes(action));
}

export function AppLayout(): ReactElement {
  const { memberships, currentCompanyId, permissions } = useAuth();

  const visibleEntries = useMemo(
    () => NAV_ENTRIES.filter((entry) => isVisible(entry, permissions)),
    [permissions],
  );

  const currentMembership = useMemo(
    () => memberships.find((m) => m.companyId === currentCompanyId) ?? null,
    [memberships, currentCompanyId],
  );

  // When the user has multiple tenants we show the switcher (interactive
  // dropdown). When there's a single tenant we still render the static chip
  // so the topbar isn't visually empty and so the AppLayout tests keep
  // their `tenant-chip` testid.
  const showSwitcher = memberships.length >= 2;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a href="#main-content" className="skip-to-main">
        {t("nav.skipToContent")}
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="container flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-primary-600 font-semibold text-white">
              F
            </span>
            <span className="text-lg font-semibold text-slate-900">{t("app.name")}</span>
          </div>

          <div className="flex items-center gap-3">
            {showSwitcher ? (
              <TenantSwitcher />
            ) : (
              <span
                data-testid="tenant-chip"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
              >
                {currentMembership?.razonSocial ?? t("nav.tenant.placeholder")}
              </span>
            )}

            <UserMenu />
          </div>
        </div>
      </header>

      <div className="container flex flex-1 gap-6 py-6">
        <aside className="w-56 shrink-0">
          <nav aria-label="Principal" className="rounded border border-slate-200 bg-white p-2">
            <ul className="flex flex-col gap-1">
              {visibleEntries.map((entry) => (
                <li key={entry.to}>
                  <NavLink
                    to={entry.to}
                    end={entry.to === "/"}
                    className={({ isActive }) =>
                      cn(
                        "block rounded px-3 py-2 text-sm font-medium",
                        isActive
                          ? "bg-primary-50 text-primary-700"
                          : "text-slate-700 hover:bg-slate-100",
                      )
                    }
                  >
                    {entry.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main id="main-content" tabIndex={-1} className="flex-1">
          <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
