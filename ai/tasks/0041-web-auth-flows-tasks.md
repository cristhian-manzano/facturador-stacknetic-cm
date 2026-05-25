---
id: TASKS-0041
spec: SPEC-0041
plan: PLAN-0041
title: Web auth flows — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0041 — Web auth flows

> Checklist for [SPEC-0041](../specs/0041-web-auth-flows.md) + [PLAN-0041](../plans/0041-web-auth-flows-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never display "email no encontrado" / "ese usuario no existe" / similar hints. Always generic.
- ❌ Never store login state in localStorage.
- ❌ Never accept absolute URLs or protocol-relative URLs in the `next` query param.
- ✅ Every tenant switch calls `queryClient.clear()` AND refreshes AuthContext.
- ✅ Every mutating action sends `X-CSRF-Token`.

## 1. Login page

- [ ] **1.1** `apps/web/src/routes/login.tsx`:
  - Form fields email + password.
  - Submit via `apiFetch("/api/v1/auth/login", { method:"POST", json, schema: LoginResponseSchema })`.
  - On success: `auth.refresh()`; navigate to sanitised `next` or `/`.
  - On 401: show "Credenciales inválidas" banner.
  - On 429: show throttle banner.
  - On 400: inline field errors from `problem.errors`.
  - Disable submit while pending; spinner inside button.
    **Validate**: see §5.

## 2. Tenant select + switcher

- [ ] **2.1** `/tenants/select` route lists `me.tenants` with role chips. Click → switch → navigate to `/`.
      **Validate**: see §5.

- [ ] **2.2** `TenantSwitcher` dropdown in topbar; click tenant → POST `/api/v1/session/tenant` → `qc.clear()` → `auth.refresh()`.
      **Validate**: see §5.

## 3. RequirePermission

- [ ] **3.1** `apps/web/src/auth/RequirePermission.tsx`:
  - Reads `useAuth().permissions`; if missing required action → `<Navigate to="/forbidden" replace>`.
  - Else renders `<Outlet />` or `children`.
    **Validate**: see §5.

## 4. Logout & next-sanitiser & 403 page

- [ ] **4.1** `UserMenu.tsx` includes a "Cerrar sesión" button calling `apiFetch("/api/v1/auth/logout", { method:"POST" })`, then `auth.refresh()`.
      **Validate**: pressing the button transitions AuthContext to unauthenticated and routes to `/login`.

- [ ] **4.2** `apps/web/src/auth/sanitise-next.ts`:

  - Accept only paths starting with `/` AND not `//`. Reject protocols.
  - Default to `/` on rejection.
    **Validate**: tests below.

- [ ] **4.3** `/forbidden` page with "No tienes permiso" copy and a link to `/`.
      **Validate**: snapshot test.

## 5. Tests

- [ ] **5.1** `login.test.tsx`:

  - MSW returns 401 generic ProblemDetail → banner "Credenciales inválidas"; no email hint.
  - MSW returns 429 → throttle banner.
  - MSW returns 200 → navigate to `next` (default `/`).
  - MSW returns 400 with `errors=[{identificador:"email",mensaje:"requerido",tipo:"ERROR"}]` → inline error under email field.
    **Validate**: pass.

- [ ] **5.2** `tenants-select.test.tsx`:

  - Renders list with role chips.
  - Click a tenant → POST `/session/tenant` once with `{ companyId }`; `qc.clear()` called; navigate to `/`.
    **Validate**: pass.

- [ ] **5.3** `TenantSwitcher.test.tsx`:

  - Same flow inside topbar.
  - Pre-switch CSRF cookie value differs from post-switch (MSW handler simulates `Set-Cookie` rotation).
    **Validate**: pass.

- [ ] **5.4** `RequirePermission.test.tsx`:

  - With `permissions: ["invoice.read"]` and required `"invoice.create"`: redirects to `/forbidden`.
  - With required `"invoice.read"`: renders children.
    **Validate**: pass.

- [ ] **5.5** `sanitise-next.test.ts`:
  - `/dashboard` → `/dashboard`.
  - `/invoices?x=1` → `/invoices?x=1`.
  - `https://evil.com` → `/`.
  - `//evil.com/x` → `/`.
  - `javascript:alert(1)` → `/`.
  - ``(empty) →`/`.
    **Validate**: pass.

## 6. Manual smoke (developer)

- [ ] **6.1** Start compose; seed user; navigate to `http://localhost:5173`. Redirected to `/login`. Enter wrong password → generic error. Enter correct password → routed to `/`. Open devtools → CSRF cookie present, session cookie HttpOnly.
- [ ] **6.2** Switch tenant via topbar. Observe CSRF cookie value change. Make a request via the SPA (e.g., open Facturas list — placeholder OK for SPEC-0042); succeeds.
- [ ] **6.3** Click "Cerrar sesión" → redirected to `/login`.

## 7. Acceptance criteria

- [ ] AC-1: Generic login error; no email-existence hint.
- [ ] AC-2: Tenant switch rotates CSRF and clears query cache.
- [ ] AC-3: RequirePermission redirects to `/forbidden` when missing action.
- [ ] AC-4: `next` sanitised against open-redirect.
- [ ] AC-5: Logout works end-to-end.
- [ ] AC-6: Tests cover happy + failure + redirect paths.
- [ ] AC-7: No credential storage in localStorage.

## 8. Definition of Done

- All boxes ticked; tests green; manual smoke green.
- Review file `ai/reviews/0041-web-auth-flows-review.md` written.
