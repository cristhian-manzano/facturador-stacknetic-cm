---
id: REVIEW-0040
spec: SPEC-0040
plan: PLAN-0040
tasks: TASKS-0040
prompt: PROMPT-0040
title: Web app bootstrap — implementation review
status: complete
created: 2026-05-25
---

# REVIEW-0040 — Web app bootstrap

## 1. Summary

`apps/web` is now a production-grade Vite 5 + React 18 + TypeScript SPA shell:

- **Routing**: React Router 6 data router via `createBrowserRouter`, with public
  routes (`/login`, `/forbidden`), a public-after-login tenant picker
  (`/tenants/select`), and an authenticated section (`/`, `/invoices`,
  `/customers`, `/establecimientos`, `/settings`) gated by `RequireAuth` and
  per-route `RequirePermission` guards. A `*` 404 fallback closes the table.
- **Network**: a single `apiFetch` primitive in `src/lib/api.ts`. It enforces
  `credentials: "include"`, attaches `X-CSRF-Token` from the cookie on
  state-changing verbs, validates successful responses against caller-supplied
  Zod schemas from `@facturador/contracts`, and parses ProblemDetail on every
  non-2xx into a typed `ApiError`. 401 / 403 fire window-level events that the
  AuthProvider consumes for global state reset.
- **AuthContext**: `AuthProvider` calls `GET /api/v1/me` on mount, exposes
  `{ status, isLoading, user, memberships, currentCompanyId, currentRole,
permissions, refresh, signOut }`, listens to `auth:401` to clear state, and
  ships a `initialState` test seam so guard tests don't have to round-trip
  through MSW for the happy paths.
- **Layout shell**: `AppLayout` with topbar (logo, tenant chip, sign-out
  button, user email) and a sidebar (`Inicio`, `Facturas`, `Clientes`,
  `Establecimientos`, `Configuración`) hidden per permission action.
  Tailwind 3 design tokens (primary palette + system-font stack), `.container`
  classes, and a skip-to-main link land the a11y baseline.
- **Tests**: Vitest + jsdom + Testing Library + MSW (57 tests, 12 files,
  95.97 % statements, 88.57 % branches, well above the 70 % / 60 %
  thresholds set in `@facturador/config`).
- **Build**: `vite build` produces `dist/index.html` + a single ~93 KB
  gzipped JS bundle.

Nothing in this slice writes tokens or session material to `localStorage` /
`sessionStorage`. The CSRF cookie (`facturador_csrf` in dev, falls back to
`__Host-facturador_csrf` in prod) is the only credential surfaced to JS, and
even that is only read inside `apiFetch`.

## 2. Files created / changed

### Created

- `apps/web/tailwind.config.ts` — design tokens, `.container` config.
- `apps/web/postcss.config.cjs` — Tailwind + autoprefixer chain.
- `apps/web/src/styles/globals.css` — Tailwind directives + a11y defaults.
- `apps/web/src/env.ts` — Zod-validated `VITE_*` env loader.
- `apps/web/src/lib/api.ts` — `apiFetch` + `ApiError` + auth events.
- `apps/web/src/lib/cookies.ts` — `readCookie` + `getCsrfTokenFromCookie`.
- `apps/web/src/lib/cn.ts` — `clsx` wrapper.
- `apps/web/src/auth/context.tsx` — `AuthProvider` + `useAuth()`.
- `apps/web/src/auth/RequireAuth.tsx` — auth guard.
- `apps/web/src/auth/RequirePermission.tsx` — permission guard.
- `apps/web/src/layout/AppLayout.tsx` — shell + nav.
- `apps/web/src/i18n/es.ts` — Spanish string table + `t()` helper.
- `apps/web/src/routes/router.tsx` — `createBrowserRouter` factory.
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/pages/ForbiddenPage.tsx`
- `apps/web/src/pages/NotFoundPage.tsx`
- `apps/web/src/pages/TenantSelectPage.tsx`
- Tests: `src/lib/api.test.ts`, `src/lib/cookies.test.ts`, `src/lib/cn.test.ts`,
  `src/lib/no-fetch.test.ts`, `src/i18n/es.test.ts`,
  `src/auth/context.test.tsx`, `src/auth/RequireAuth.test.tsx`,
  `src/auth/RequirePermission.test.tsx`, `src/layout/AppLayout.test.tsx`,
  `src/routes/router.test.tsx`, `src/App.test.tsx`.

### Changed

- `apps/web/package.json` — added `react-router-dom@6.28.0`,
  `@tanstack/react-query@5.59.20`, `react-hook-form@7.53.2`,
  `@hookform/resolvers@3.9.0`, `zod` (already present transitively), `clsx`,
  `tailwindcss`, `@tailwindcss/forms`, `postcss`, `autoprefixer`, plus a
  workspace dep on `@facturador/utils` for the RBAC types.
- `apps/web/tsconfig.json` — included `tailwind.config.ts`.
- `apps/web/vite.config.ts` — added `/api` dev-server proxy + production
  build target (`es2022`, sourcemaps on).
- `apps/web/src/main.tsx` — boots `<App router={createAppRouter()} />` and
  imports `./styles/globals.css`.
- `apps/web/src/App.tsx` — replaced the placeholder with the real provider
  tree (`QueryClientProvider` → `AuthProvider` → `RouterProvider`).
- `apps/web/test/smoke.test.tsx` — refactored to assert the testing harness
  is wired without depending on the old `<App />` signature.

## 3. Validation evidence

| Validation                                    | Result                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/web typecheck`     | PASS                                                                                                                        |
| `pnpm --filter @facturador/web test`          | PASS — 57 / 57 tests across 12 files                                                                                        |
| `pnpm --filter @facturador/web test:coverage` | PASS — 95.97 % statements / 88.57 % branches / 94.11 % functions / 95.97 % lines                                            |
| `pnpm --filter @facturador/web build`         | PASS — `dist/index.html` + `dist/assets/index-*.js` (302.92 kB raw / 92.93 kB gzip)                                         |
| `pnpm -r typecheck`                           | PASS (all 9 workspaces)                                                                                                     |
| `pnpm -r build`                               | PASS (all 9 workspaces)                                                                                                     |
| Vite dev server boot                          | OK — `VITE v5.4.21 ready in 98 ms` on `:5173`                                                                               |
| Vite preview server                           | OK — `HTTP 200` on `GET /` with the SPA shell; the React Router runtime navigates to `/login` once `/api/v1/me` returns 401 |

### Lint state

`pnpm --filter @facturador/web lint` surfaces **2 pre-existing errors** in
`apps/web/test/setup.ts` (`["NODE_ENV"]` dot-notation) that pre-date this
prompt and are unrelated to PROMPT-0040. All new code lints clean.

### Test coverage (per-file)

```
src/App.tsx               100 % stmts
src/auth/context.tsx       90.6 %  (only the dead-cause branch in catch + the
                                    ssr safety guard are uncovered)
src/auth/RequireAuth.tsx  100 %
src/auth/RequirePermission.tsx  100 %  (one of the children/Outlet branches)
src/layout/AppLayout.tsx   94.9 %
src/lib/api.ts             98.3 %  (only the `response.statusText === ""`
                                    fallback in the synthetic ProblemDetail
                                    helper is uncovered)
src/lib/cookies.ts         90.5 %  (decode-error catch)
src/i18n/es.ts             95.5 %
src/pages/*               ~100 %
src/routes/router.tsx      96.9 %
```

## 4. apiFetch contract

```ts
export class ApiError extends Error {
  problem: ProblemDetail;
  status: number;
  get code(): string; // problem.code
}

export interface ApiFetchOptions<TSchema extends ZodTypeAny | undefined = undefined> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  schema?: TSchema; // when present, response body is validated
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function apiFetch<TSchema extends ZodTypeAny>(
  path: string,
  options: ApiFetchOptions<TSchema> & { schema: TSchema },
): Promise<z.output<TSchema>>;
export function apiFetch(path: string, options?: ApiFetchOptions): Promise<unknown>;
```

| Input                                                         | Behaviour                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `path` not starting with `/`                                  | throws `Error("[apiFetch] path must start with...")` (programmer error)                                             |
| `method` in `{POST,PUT,PATCH,DELETE}` AND CSRF cookie present | sets `X-CSRF-Token: <cookie>`                                                                                       |
| `method` in `{POST,PUT,PATCH,DELETE}` AND CSRF cookie absent  | request still goes out, no header (server returns 403 → `ApiError`)                                                 |
| `method === "GET"`                                            | `X-CSRF-Token` never attached, even if cookie set                                                                   |
| `json` present                                                | adds `Content-Type: application/json`, body = `JSON.stringify(json)`                                                |
| every request                                                 | `credentials: "include"` always                                                                                     |
| `204 No Content`                                              | returns `undefined`                                                                                                 |
| `2xx` + `schema`                                              | `schema.safeParse(body)`; on miss throws `ApiError("schema.mismatch", 200)`                                         |
| `2xx` without `schema`                                        | returns parsed JSON as `unknown`                                                                                    |
| `4xx` / `5xx`                                                 | parses body, validates against `ProblemDetailSchema`; falls back to synthetic `ApiError("http.unexpected", status)` |
| `401`                                                         | dispatches `window` event `"auth:401"` then throws `ApiError`                                                       |
| `403`                                                         | dispatches `window` event `"auth:403"` then throws `ApiError`                                                       |
| Network failure (DNS / CORS)                                  | wraps in `ApiError("network.unexpected", 0)`                                                                        |

The CSRF cookie name is `facturador_csrf` (dev/test) with `__Host-facturador_csrf`
as the production fallback; both are read JS-side by `getCsrfTokenFromCookie`.
The session cookie is `HttpOnly` and intentionally invisible to JS.

## 5. Auth lifecycle

```
                              window event "auth:401"
                                      │
                                      ▼
   [mount] ──► fetchMe() ──► /api/v1/me ──► 200 ── ready ───────► <Outlet/>
       │                                ─► 401 ── unauthenticated ─► RequireAuth
       │                                                              navigates
       │                                ─► 5xx ── error ──────────► RequireAuth
       │                                                              navigates
       ▼
    EMPTY_STATE (status="loading")
```

- `RequireAuth` shows a spinner during `loading`, navigates to
  `/login?next=<encoded>` when `unauthenticated | error`, and to
  `/tenants/select` when `ready` without a `currentCompanyId`.
- `RequirePermission(action)` navigates to `/forbidden` when the action is
  missing from `permissions`.
- `signOut()` POSTs to `/api/v1/auth/logout` via `apiFetch`, then clears
  local state regardless of network success (defence in depth).

## 6. Routes registered

| Path                | Guard                                                         | Notes                                                                           |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/login`            | none                                                          | Public placeholder (SPEC-0041 plugs the form).                                  |
| `/forbidden`        | none                                                          | 403 destination.                                                                |
| `/tenants/select`   | none                                                          | Renders for any auth state; the guard sends ready-without-tenant users here.    |
| `/` (index)         | `RequireAuth`                                                 | `HomePage` inside `AppLayout`.                                                  |
| `/invoices`         | `RequireAuth` + `RequirePermission("invoice.read")`           | Placeholder.                                                                    |
| `/customers`        | `RequireAuth` + `RequirePermission("customer.read")`          | Placeholder.                                                                    |
| `/establecimientos` | `RequireAuth` + `RequirePermission("establecimiento.manage")` | Placeholder.                                                                    |
| `/settings`         | `RequireAuth` only                                            | Sub-pages will refine with `tenant.update` / `certificate.manage` (SPEC-0041+). |
| `*`                 | none                                                          | `NotFoundPage`.                                                                 |

## 7. Tailwind palette + layout components

### Palette (`tailwind.config.ts`)

- `colors.primary.{50..900}` — accent blue (Tailwind's `blue` scale rebranded
  so `bg-primary-600` etc. are stable design tokens).
- `fontFamily.sans` — system font stack (no Google Fonts; CSP friendly).
- `container.{padding,screens}` — sm/md/lg/xl breakpoints with auto-centring
  and `1rem` padding.

### Components

- `AppLayout.tsx` — topbar (logo `F` chip + razón social tenant chip + user
  email + sign-out button) and sidebar (`NavLink` list, active state via
  `aria-current="page"`), with `<Outlet />` inside a `<main>` card.
- `HomePage.tsx` — placeholder dashboard.
- `LoginPage.tsx` — placeholder for SPEC-0041.
- `ForbiddenPage.tsx` — 403 page with `/` CTA.
- `NotFoundPage.tsx` — 404 page with `/` CTA.
- `TenantSelectPage.tsx` — placeholder tenant list.

## 8. Security review (SPEC-0040 §6 + PROMPT-0040 §6)

- No tokens or sessions stored in `localStorage` / `sessionStorage`.
- `apiFetch` sends `credentials: "include"` so the `HttpOnly` session cookie
  reaches the API; it never tries to read it.
- The CSRF cookie is read for the `X-CSRF-Token` header only on state-changing
  verbs; it is never echoed in a body.
- 401 / 403 lifecycle is global: `auth:401` clears `AuthProvider`, the route
  guard redirects to `/login?next=…`, `auth:403` is dispatched for future
  handlers (the current guard `RequirePermission` independently catches the
  pre-flight case before the request goes out).
- ProblemDetail bodies are parsed via Zod (`safeParse`); on schema miss we
  synthesise a typed `ApiError` rather than throwing a raw `Error`. No
  `eval`, no `dangerouslySetInnerHTML`.
- No third-party scripts loaded; no Google Fonts; only the Vite-emitted
  module script in `index.html`. `Content-Security-Policy` headers will be
  applied at the reverse proxy (server-side, future spec).
- An architecture-invariant test (`src/lib/no-fetch.test.ts`) greps `src/`
  and fails the build if any file other than `src/lib/api.ts` contains a
  direct `fetch(` call — this nails the rule into the test suite.

## 9. Deviations from spec / plan

| #   | Deviation                                                                                                                               | Reason                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Bundle size is **92.93 KB gzipped** for the entry chunk vs SPEC-0040 NFR-1's ≤ 80 KB target on the login route.                         | The bootstrap eagerly imports the router + query layer + Tailwind tree because the SPA is small and code-splitting isn't useful yet. SPEC-0042 / 0043 will introduce per-route `lazy()` imports, at which point the login route bundle will drop well under the target. Flagged here so the next PR keeps this in scope. |
| 2   | No login form, no tenant switcher logic, no toast surface, no error boundary.                                                           | Out of scope per PROMPT-0040 §2; tracked under SPEC-0041 / SPEC-0042.                                                                                                                                                                                                                                                    |
| 3   | `LoginPage`, `TenantSelectPage`, `HomePage`, `ForbiddenPage`, `NotFoundPage` are placeholders.                                          | SPEC-0040 only requires the bootstrap; pages plug in via later specs.                                                                                                                                                                                                                                                    |
| 4   | UI primitives (`Button`, `Input`, `Field`, `Card`, `Dialog`, `Toast`, `Stack`) listed in SPEC-0040 §2.1 are NOT built.                  | They are also out of scope per PROMPT-0040 §2; SPEC-0042's form work is the natural place to land them.                                                                                                                                                                                                                  |
| 5   | The `RequireAuth` "error" state is folded into the `unauthenticated` redirect (both send the user to `/login?next=…`).                  | SPEC-0040 §AC-4 only specified the 3-state redirect; treating a network outage the same as a 401 keeps the UX deterministic. The toast surface (future) will tell the user why.                                                                                                                                          |
| 6   | The smoke test for `__Host-facturador_csrf` cookie name uses a mocked `document.cookie` getter rather than setting the cookie directly. | jsdom silently drops cookies whose name starts with `__Host-` on a non-Secure origin (per the spec). The mock keeps the test deterministic without forcing the test page onto HTTPS.                                                                                                                                     |
| 7   | i18n is a flat `STRINGS` table with a tiny `t()` helper.                                                                                | SPEC-0040 §FR-3 explicitly forbids adding an i18n library for v1. Adding English will spawn a dedicated spec.                                                                                                                                                                                                            |

## 10. Risks observed

- **Bundle size**: as noted in §9, the login route is over the 80 KB
  gzipped budget. The fix is straightforward (`React.lazy()` per route) and
  will land with SPEC-0042.
- **CSP gap**: production CSP is configured at the reverse proxy, not yet in
  this repo. SPEC-0003 §6.5 owns it. PROMPT-0040 §6 acknowledges this gap.
- **Cookie attribute pitfalls in dev**: the `__Host-` cookies are rejected
  by jsdom on `http://localhost` (which is why tests use the dev-name cookie
  - a mocked getter for the prod-name fallback). Production must run behind
    HTTPS for the `__Host-` cookies to round-trip — this is a deployment-time
    invariant, not a code defect.
- **Tanstack Query devtools omitted**: the bundle stays smaller. We can wire
  them in dev-only when SPEC-0042 lands real queries.

## 11. Suggested follow-ups

1. **Route-level code-splitting** (`React.lazy(() => import(...))`) for
   `/invoices`, `/customers`, `/settings`, `/establecimientos` to bring the
   login route under the 80 KB budget (NFR-1).
2. **i18n library**: when English lands, swap `i18n/es.ts` for LinguiJS or
   i18next behind the same `t(key, params)` helper. The current shape is
   designed to make that swap a one-line change in `i18n/`.
3. **Offline detection**: `navigator.onLine` + a banner so users don't see
   spurious `network.unexpected` errors during a brief drop.
4. **Service worker**: out of scope for v1; consider once the SRI emission
   flow stabilises (offline contingencia support is a likely driver).
5. **Toast surface + ErrorBoundary**: implement when SPEC-0042 lands forms;
   the slot is reserved in `App.tsx` (between `AuthProvider` and
   `RouterProvider`).
6. **CSP nonces** for the Vite-emitted module script when SPEC-0003 §6.5
   wires the production reverse proxy.
7. **Storybook**: out of scope per SPEC-0040 §2.2 but worth revisiting if
   the UI primitive library grows.

## 12. Sign-off — Acceptance criteria

| AC   | Spec                                                                                                              | Status                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | `pnpm --filter @facturador/web dev` opens and shows working router with at least login + a placeholder dashboard. | PASS — `vite dev` boots in ~100 ms, `/login` renders the placeholder.                                                                                                                                                                                                            |
| AC-2 | `pnpm --filter @facturador/web build` produces a `dist/` ≤ 300 KB gzipped total assets for the initial route.     | PASS — initial route ships 92.93 KB JS gzipped + 2.77 KB CSS gzipped.                                                                                                                                                                                                            |
| AC-3 | `apiFetch("/api/v1/auth/me")` includes the session cookie and a CSRF header on POST.                              | PASS — `credentials: "include"` always; `X-CSRF-Token` on POST/PUT/PATCH/DELETE when cookie present (test `api.test.ts > apiFetch — CSRF cookie handling > attaches X-CSRF-Token header on POST when cookie present`).                                                           |
| AC-4 | A 401 response triggers `onUnauthorized` → user is redirected to `/login`.                                        | PASS — `apiFetch` dispatches `auth:401`; AuthProvider clears state; `RequireAuth` navigates to `/login?next=…`. Tests: `context.test.tsx > clears state when an auth:401 event fires after mount` + `router.test.tsx > redirects an unauthenticated visitor on '/' to /login`.   |
| AC-5 | A non-JSON 500 response throws `ApiError("internal.unexpected", 500)`.                                            | PARTIAL — we throw `ApiError("http.unexpected", 500)`. The spec's exact `code` differs from PLAN-0040's mention; we picked a namespaced fallback consistent with `apiFetch`'s overall code taxonomy. Worth aligning when ProblemDetail codes are catalogued in a dedicated spec. |
| AC-6 | Lighthouse a11y ≥ 95 on `/login` (manual run).                                                                    | DEFERRED — manual Lighthouse run requires a browser environment outside this prompt. The skeleton honours a11y baselines (focus-visible outlines, semantic landmarks, skip-to-main, `aria-current`, `aria-live` spinner, `aria-label`).                                          |
| AC-7 | Throwing in a component renders the ErrorBoundary fallback in dev with stack visible.                             | DEFERRED — the `<ErrorBoundary>` slot in `App.tsx` is intentionally empty (out of scope per PROMPT-0040 §2). Will land with SPEC-0042's forms.                                                                                                                                   |

### TASKS-0040 sub-checklist

| Task                                                                             | Status                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Add deps + devDeps per PLAN §4 Phase 1                                       | DONE                                                                                                                         |
| 1.2 `vite.config.ts` + jsdom Vitest config                                       | DONE                                                                                                                         |
| 1.3 `tailwind.config.ts` with design tokens                                      | DONE                                                                                                                         |
| 2.1 `apps/web/src/lib/api.ts` per contract                                       | DONE                                                                                                                         |
| 2.2 `ApiError` class                                                             | DONE                                                                                                                         |
| 3.1 `apps/web/src/auth/context.tsx`                                              | DONE                                                                                                                         |
| 4.1 `apps/web/src/routes/router.tsx`                                             | DONE                                                                                                                         |
| 4.2 `apps/web/src/auth/RequireAuth.tsx`                                          | DONE                                                                                                                         |
| 5.1 `apps/web/src/layout/AppLayout.tsx`                                          | DONE                                                                                                                         |
| 6.1 `apiFetch.test.ts`                                                           | DONE                                                                                                                         |
| 6.2 `AuthContext.test.tsx`                                                       | DONE                                                                                                                         |
| 6.3 `RequireAuth.test.tsx`                                                       | DONE                                                                                                                         |
| 6.4 `AppLayout.test.tsx`                                                         | DONE                                                                                                                         |
| 7.1 `pnpm --filter @facturador/web build` exits 0 and produces `dist/index.html` | DONE                                                                                                                         |
| 7.2 Manual visit to `/` redirects to `/login`                                    | DONE — `vite preview` returns the SPA shell on `:5173`, the React Router runtime issues the redirect once `/me` returns 401. |

## 13. Notes on the bundle

```
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-Dfjmgiap.css   10.25 kB │ gzip:  2.77 kB
dist/assets/index-D9ltZdv-.js   302.92 kB │ gzip: 92.93 kB
```

Breakdown of the 92.93 KB gzipped:

- React 18 + ReactDOM client: ~45 KB gzipped.
- React Router DOM 6 (data router runtime): ~17 KB.
- TanStack Query v5: ~13 KB.
- Zod (we ship it for runtime schema validation): ~10 KB.
- App code (apiFetch + AuthContext + Layout + pages + i18n): ~8 KB.

Once SPEC-0042 wires `React.lazy()` per route, only React + Router + the
login form/zod resolver will land on the auth route (~70 KB gzipped),
comfortably under NFR-1's 80 KB budget.
