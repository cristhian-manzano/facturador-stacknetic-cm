---
id: PLAN-0040
spec: SPEC-0040
title: Web app bootstrap — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0040 — Web app bootstrap

> Implementation plan for [SPEC-0040](../specs/0040-web-app-bootstrap.md). Depends on PLAN-0001/0002/0005/0007.

## 1. Goal

Stand up `apps/web` as a Vite 5 + React 18 + TypeScript SPA with:

- React Router 6 (data router).
- TanStack Query v5.
- Tailwind 3 design tokens.
- React Hook Form + zodResolver.
- `apiFetch` helper: same-origin (or `VITE_API_BASE_URL`), `credentials: "include"`, auto-attaches `X-CSRF-Token` header from the readable CSRF cookie, ProblemDetail-aware error handling.
- Layout shell with sidebar + topbar + content slot.
- Spanish-only i18n in `i18n/es.ts` (string table).
- `<RequireAuth>` route guard (used in SPEC-0041).

## 2. Inputs

- [SPEC-0040](../specs/0040-web-app-bootstrap.md) — authoritative.
- [SPEC-0005](../specs/0005-shared-contracts.md) — consume Zod schemas.
- [SPEC-0006](../specs/0006-error-model-and-logging.md) — `ProblemDetail` shape.
- [SPEC-0007](../specs/0007-testing-strategy.md) — Vitest jsdom + Testing Library.

## 3. Architecture decisions

| Decision                                                                                                                                                                                | Rationale                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Vite 5 with `@vitejs/plugin-react`.                                                                                                                                                     | Standard.                                       |
| React 18 with concurrent features (Suspense, transitions).                                                                                                                              | Future-proof.                                   |
| TanStack Query v5 for server state; React Hook Form for forms; Zod for boundary validation.                                                                                             | Battle-tested combo; minimal global state.      |
| Tailwind 3 (PostCSS plugin); `tailwind.config.ts` exports tokens consumed by components.                                                                                                | Designer-friendly.                              |
| Router: `createBrowserRouter` (data router).                                                                                                                                            | Loaders, actions, error boundaries first-class. |
| `apiFetch` is a thin wrapper around `fetch` that: reads CSRF cookie, sets `X-CSRF-Token` for mutating verbs, JSON-parses body, parses ProblemDetail on non-2xx into a typed `ApiError`. | One place to enforce conventions.               |
| AuthContext exposes `{ user, currentCompanyId, permissions, refresh, logout }`. Populated by `/api/v1/me`.                                                                              | Single source of truth for FE auth state.       |
| 403 from API redirects to `/forbidden`; 401 redirects to `/login?next=...`.                                                                                                             | Predictable UX.                                 |
| No localStorage of secrets. CSRF cookie is the only credential surfaced to JS.                                                                                                          | Defence in depth.                               |

## 4. Phases

### Phase 1 — Bootstrap

1. `apps/web/package.json`: deps `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod` (peer of contracts), `clsx`, `tailwindcss`, `postcss`, `autoprefixer`. DevDeps: `@vitejs/plugin-react`, `vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `msw`.
2. `vite.config.ts` with React plugin + Tailwind PostCSS chain.
3. `tailwind.config.ts` with design tokens (colors, spacing scale).
4. `apps/web/src/main.tsx` mounts `<App />`.
5. `apps/web/index.html` minimal shell.

### Phase 2 — apiFetch + ApiError

`apps/web/src/lib/api.ts`:

- `apiFetch<T>(path, { method, json, schema, ... }): Promise<T>`:
  - Builds URL from `VITE_API_BASE_URL` (defaults to `""` for same-origin).
  - Headers: `Content-Type: application/json` when json body present.
  - Reads `facturador_csrf` (or `__Host-facturador_csrf` in prod) via `document.cookie`; sets `X-CSRF-Token` for mutating methods.
  - `credentials: "include"`.
  - On non-2xx: parses JSON, validates against `ProblemDetailSchema`, throws `ApiError`.
  - On 401: dispatches `auth:401` event (consumed by AuthContext).
  - On 403: dispatches `auth:403`.

### Phase 3 — AuthContext

`apps/web/src/auth/context.tsx`:

- Provider that on mount calls `/api/v1/me`. Stores state.
- Listens to `auth:401` to flush state.
- Exposes `useAuth()`.

### Phase 4 — Router + guards

`apps/web/src/routes/router.tsx`:

- `createBrowserRouter`:
  - `/login` → public (SPEC-0041 implements).
  - `/forbidden` → public (403 page).
  - `/` → `<RequireAuth><AppLayout>` → child routes (`/invoices`, `/customers`, `/settings`, etc.; only the layout shell here).

`apps/web/src/auth/RequireAuth.tsx`:

- If `user === null` after bootstrap, redirect to `/login?next=...`.
- If `currentCompanyId == null`, redirect to `/tenants/select` (placeholder route).

### Phase 5 — Layout shell

`apps/web/src/layout/AppLayout.tsx`:

- Sidebar (nav links: Facturas, Clientes, Configuración).
- Topbar (current tenant chip + user menu).
- Outlet for child routes.

### Phase 6 — i18n

`apps/web/src/i18n/es.ts`:

- A flat object with keys grouped (`auth.login.title`, `invoices.list.empty`, ...).
- Tiny `t(key, params?)` helper supporting `{var}` interpolation. No external lib for v1.

### Phase 7 — Tests

- `apiFetch.test.ts`:
  - 200 happy path.
  - 401 dispatches event.
  - 403 dispatches event.
  - 400 ProblemDetail parsed → throws ApiError with `errors`.
  - CSRF header attached for POST/PUT/PATCH/DELETE.
- `RequireAuth.test.tsx`:
  - No user → redirect to `/login`.
  - User but no tenant → redirect to `/tenants/select`.
  - User + tenant → renders children.
- `AppLayout.test.tsx`: renders nav links visible per permissions.

## 5. Risks & mitigations

| Risk                                                       | Mitigation                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF cookie unreadable due to `HttpOnly` misconfiguration. | Server sets CSRF cookie without `HttpOnly` per SPEC-0010. Test in dev.                                                                               |
| Mixed-origin dev (api on 3000, web on 5173).               | `VITE_API_BASE_URL=http://localhost:3000` + `credentials: "include"`; backend CORS allows the dev origin + `Access-Control-Allow-Credentials: true`. |
| Stale react-query cache after tenant switch.               | SPEC-0041 calls `queryClient.clear()` on tenant switch.                                                                                              |
| Tailwind tree-shake misses dynamic class names.            | Use `clsx` + safelist common dynamic patterns.                                                                                                       |

## 6. Validation strategy

- All web tests pass; coverage ≥ 70% statements.
- Manual smoke: `pnpm --filter @facturador/web dev` opens `http://localhost:5173` showing the login redirect.
- `pnpm --filter @facturador/web build` exits 0.

## 7. Exit criteria

- All SPEC-0040 ACs pass.
- Layout shell and router live; SPEC-0041 plugs into them.

## 8. Out of scope

- Real auth flows → SPEC-0041.
- Invoice screens → SPEC-0042, SPEC-0043.
- Internationalisation beyond Spanish — out.
- PWA / service worker — out.
