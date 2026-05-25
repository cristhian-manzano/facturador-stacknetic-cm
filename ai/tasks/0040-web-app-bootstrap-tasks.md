---
id: TASKS-0040
spec: SPEC-0040
plan: PLAN-0040
title: Web app bootstrap — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0040 — Web app bootstrap

> Checklist for [SPEC-0040](../specs/0040-web-app-bootstrap.md) + [PLAN-0040](../plans/0040-web-app-bootstrap-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No localStorage / sessionStorage of credentials or tokens.
- ❌ No direct `fetch` calls in components; always `apiFetch`.
- ❌ No `console.log` in source.
- ✅ All API responses validated with Zod schemas from `@facturador/contracts` before consumers see them.
- ✅ Layout shell and route guards keep working even when API returns 401/403.

## 1. Dependencies

- [ ] **1.1** Add deps + devDeps per PLAN §4 Phase 1 to `apps/web/package.json`. Pin majors.
      **Validate**: `pnpm install` exits 0.

- [ ] **1.2** `vite.config.ts` configured with React + Tailwind PostCSS; defines `test` config that defers to `defineFacturadorVitestConfig({ environment: "jsdom", ... })`.
      **Validate**: `pnpm --filter @facturador/web dev` opens 5173; `pnpm --filter @facturador/web test` runs.

- [ ] **1.3** `tailwind.config.ts` with design tokens; PostCSS chain in `postcss.config.cjs`.
      **Validate**: a sample component using `bg-primary-500` renders the expected colour in a Testing Library snapshot of computed styles (or simpler: assert the `class` attribute exists; full visual checks happen manually).

## 2. apiFetch

- [ ] **2.1** `apps/web/src/lib/api.ts`:

  - `apiFetch<TOut>(path, { method?, json?, schema?: ZodSchema<TOut>, signal? })`:
    - Builds URL from `import.meta.env.VITE_API_BASE_URL` (default empty for same-origin).
    - Sets `credentials: "include"`.
    - Adds JSON body and headers if `json` provided.
    - Reads CSRF cookie value (function `readCookie("facturador_csrf")` falls back to `__Host-facturador_csrf` if NOT in dev).
    - For mutating methods (POST/PUT/PATCH/DELETE): sets `X-CSRF-Token`.
    - On non-2xx: parses JSON; tries `ProblemDetailSchema.parse(...)`; throws `ApiError`.
    - On 401: `window.dispatchEvent(new CustomEvent("auth:401"))`. On 403: `auth:403`.
    - If `schema` provided: validate response body via `schema.parse(...)`.
      **Validate**: see §6.

- [ ] **2.2** `ApiError` class extends Error with `problem: ProblemDetail`.
      **Validate**: type-only test.

## 3. AuthContext

- [ ] **3.1** `apps/web/src/auth/context.tsx`:
  - `AuthProvider` calls `apiFetch("/api/v1/me", { schema: MeResponseSchema })` on mount.
  - State: `{ status: "loading"|"unauthenticated"|"ready", user?, currentCompanyId?, permissions: Action[] }`.
  - Listens to `auth:401` to clear state.
  - Listens to `auth:403` to keep state but route guard handles redirect.
  - Exposes `useAuth()`.
    **Validate**: see §6.

## 4. Router & guards

- [ ] **4.1** `apps/web/src/routes/router.tsx`:

  - `createBrowserRouter([...])` with `/login`, `/forbidden`, `/` (wrapped in RequireAuth → AppLayout) and a placeholder `/tenants/select`.
    **Validate**: rendering `<RouterProvider router={router} />` and visiting `/` redirects to `/login` when unauthenticated.

- [ ] **4.2** `apps/web/src/auth/RequireAuth.tsx`:
  - If status === "loading", render a centered spinner.
  - If status === "unauthenticated", `<Navigate to="/login?next=...">`.
  - If status === "ready" but `currentCompanyId == null`, `<Navigate to="/tenants/select">`.
  - Otherwise render `<Outlet />`.
    **Validate**: see §6.

## 5. Layout shell

- [ ] **5.1** `apps/web/src/layout/AppLayout.tsx`:
  - Sidebar with nav links: "Facturas" (`/invoices`), "Clientes" (`/customers`), "Configuración" (`/settings`).
  - Topbar with tenant chip (placeholder) and user menu.
  - `<Outlet />` for children.
  - Each nav link hidden when `!can(role, action)` for its corresponding action — read from `useAuth().permissions`. Default route table:
    - Facturas → `invoice.read`
    - Clientes → `customer.read`
    - Configuración → `tenant.update` OR `establecimiento.manage` OR `certificate.manage` (any).
      **Validate**: render the layout with VIEWER permissions; assert Facturas + Clientes visible but Configuración hidden.

## 6. Tests

- [ ] **6.1** `apiFetch.test.ts`:

  - Happy path 200 with schema-validated body.
  - CSRF cookie present → header set for POST.
  - No CSRF cookie → header not set; request still goes out (server will reject 403, which becomes ApiError).
  - 400 ProblemDetail parsed → ApiError contains `errors[]`.
  - 401 dispatches `auth:401`.
  - 403 dispatches `auth:403`.
    **Validate**: pass.

- [ ] **6.2** `AuthContext.test.tsx`:

  - Mounting with MSW returning 200 `MeResponseSchema` → status becomes `ready`.
  - MSW returning 401 → status becomes `unauthenticated`.
    **Validate**: pass.

- [ ] **6.3** `RequireAuth.test.tsx`:

  - Unauthenticated → redirect to `/login`.
  - Authenticated, no tenant → redirect to `/tenants/select`.
  - Authenticated + tenant → renders children.
    **Validate**: pass.

- [ ] **6.4** `AppLayout.test.tsx`:
  - VIEWER permissions → Facturas+Clientes visible, Configuración hidden.
  - OWNER permissions → all visible.
    **Validate**: pass.

## 7. Build smoke

- [ ] **7.1** `pnpm --filter @facturador/web build` exits 0 and produces `dist/index.html`.
      **Validate**: pass.

- [ ] **7.2** `pnpm --filter @facturador/web dev` opens; manual visit to `/` redirects to `/login`.
      **Validate**: developer verifies in a browser (or curl + Location header on the dev SPA fallback).

## 8. Acceptance criteria

- [ ] AC-1: `apiFetch` enforces credentials + CSRF + ProblemDetail parsing.
- [ ] AC-2: AuthContext loads `/me` on mount and exposes user + permissions.
- [ ] AC-3: `RequireAuth` redirects appropriately for 3 states.
- [ ] AC-4: Layout shell respects permissions.
- [ ] AC-5: No `localStorage` of credentials.
- [ ] AC-6: Tests cover happy + error + redirect paths.
- [ ] AC-7: Build succeeds.

## 9. Definition of Done

- All boxes ticked; tests green; build green.
- Review file `ai/reviews/0040-web-app-bootstrap-review.md` written.
