---
id: PLAN-0041
spec: SPEC-0041
title: Web auth flows — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0041 — Web auth flows

> Implementation plan for [SPEC-0041](../specs/0041-web-auth-flows.md). Depends on PLAN-0010/0011/0040.

## 1. Goal

Wire the SPA auth flows:

- `/login` route with a React Hook Form + Zod resolver + Spanish copy. Generic "Credenciales inválidas" error (no email-existence hint).
- Session bootstrap on app start via `/api/v1/me`.
- Tenant switcher (`/tenants/select` + a dropdown chip in the topbar) that rotates CSRF and clears query cache.
- Route guards for permissions (`<RequirePermission action="...">` thin wrapper around `useAuth`).
- Logout button in the topbar user menu.
- A `/forbidden` (403) page.

## 2. Inputs

- [SPEC-0041](../specs/0041-web-auth-flows.md) — authoritative.
- [SPEC-0010](../specs/0010-authentication-and-sessions.md), [SPEC-0011](../specs/0011-tenants-memberships-rbac.md).
- [SPEC-0040](../specs/0040-web-app-bootstrap.md) — bootstrap (AuthContext, apiFetch).
- [ai/context/security.md](../context/security.md) — no email-existence hints.

## 3. Architecture decisions

| Decision                                                                                                                             | Rationale                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Login form fields: `email`, `password`. Validated with `LoginRequestSchema`.                                                         | Same shape as API.                         |
| Error UX: a single banner "Credenciales inválidas" regardless of cause; never enumerate emails.                                      | Mirrors server behaviour.                  |
| Submit disabled while pending; spinner inside the button.                                                                            | Standard UX.                               |
| Successful login: navigate to `?next=...` (sanitised) or `/`; AuthContext refreshes via `/me`.                                       | Predictable.                               |
| Tenant switcher: dropdown lists `me.tenants`; selection triggers `POST /api/v1/session/tenant` then `qc.clear()` + `auth.refresh()`. | Reset cache to prevent stale-tenant data.  |
| Logout: `POST /api/v1/auth/logout`, then `auth.refresh()` → unauthenticated → redirected.                                            | Clean.                                     |
| `<RequirePermission>`: returns `<Navigate to="/forbidden">` if missing permission; otherwise renders children.                       | Component-level guard.                     |
| `/forbidden` page: static, simple "No tienes permiso".                                                                               | Predictable.                               |
| If `me.currentCompanyId === null`: `/tenants/select` is the only allowed route until selection.                                      | Already enforced in SPEC-0040 RequireAuth. |

## 4. Phases

### Phase 1 — Login page

`apps/web/src/routes/login.tsx`:

- React Hook Form with zodResolver(LoginRequestSchema).
- On submit: `apiFetch("/api/v1/auth/login", { method:"POST", json: values, schema: LoginResponseSchema })`.
- On success: refresh AuthContext; navigate to sanitised `next` or `/`.
- On 401 ApiError: show generic banner.
- On 429: show "Demasiados intentos. Inténtalo más tarde."
- On 400 ApiError: show inline field errors mapped from `problem.errors[]`.

### Phase 2 — Tenant select / switcher

`apps/web/src/routes/tenants-select.tsx`:

- Lists `useAuth().user.tenants`; click → switch → navigate to `/`.

`apps/web/src/layout/TenantSwitcher.tsx`:

- Dropdown chip in the topbar; clicking a tenant calls switch endpoint, clears `queryClient`, refreshes AuthContext.

### Phase 3 — RequirePermission

`apps/web/src/auth/RequirePermission.tsx`:

- `<RequirePermission action="invoice.create">{children}</RequirePermission>` checks `useAuth().permissions` includes `action`; else redirects to `/forbidden`.

### Phase 4 — Logout

`apps/web/src/layout/UserMenu.tsx`:

- A button that calls `apiFetch("/api/v1/auth/logout", { method: "POST" })`, then refreshes AuthContext.

### Phase 5 — Sanitisation of `next`

`apps/web/src/auth/sanitise-next.ts`:

- Accept only `?next=/...` (same-origin path), else default to `/`. No protocol, no `//host`.

### Phase 6 — Tests

- `login.test.tsx`:
  - Bad creds → generic banner; no email hint.
  - 429 → throttle banner.
  - Successful login navigates to `next` or `/`.
- `TenantSwitcher.test.tsx`:
  - Switching tenant invokes `qc.clear()` and POSTs to `/session/tenant`.
- `RequirePermission.test.tsx`:
  - Missing permission → `/forbidden`.
  - Present → renders children.
- `sanitise-next.test.ts`:
  - `/dashboard` → `/dashboard`.
  - `https://evil.com/x` → `/`.
  - `//evil.com/x` → `/`.

## 5. Risks & mitigations

| Risk                                                   | Mitigation                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Open redirect via `next`.                              | Sanitiser; tests prove.                                                         |
| Stale cache after tenant switch.                       | `qc.clear()`.                                                                   |
| Race: user switches tenant while a query is in flight. | After switch, the cache is empty; subsequent fetches use the new tenant cookie. |
| Permissions array updates asynchronously.              | `useAuth` is the source; route guards read it; navigation re-renders on update. |

## 6. Validation strategy

- All listed tests pass.
- Manual smoke: login as seed user; switch tenants; CSRF cookie value changes (visible via devtools); logout works.

## 7. Exit criteria

- All SPEC-0041 ACs pass.

## 8. Out of scope

- Password reset.
- 2FA.
- Magic links / SSO.
