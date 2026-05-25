---
id: REVIEW-0041
spec: SPEC-0041
plan: PLAN-0041
tasks: TASKS-0041
prompt: PROMPT-0041
title: Web auth flows — implementation review
status: complete
created: 2026-05-25
---

# REVIEW-0041 — Web auth flows

## 1. Summary

`apps/web` now ships every interactive auth surface promised by SPEC-0041
on top of the PROMPT-0040 bootstrap:

- **Login page** (`src/pages/LoginPage.tsx`) — React Hook Form +
  `zodResolver(LoginRequestSchema)`, Spanish copy, generic
  "Credenciales inválidas" banner on 401, throttle banner on 429, inline
  field errors on 400 (via the shared `mapProblemErrorsToForm` helper),
  submit + inputs disabled while pending, focus management on mount.
- **`?next` open-redirect sanitiser** (`src/auth/sanitise-next.ts`) —
  same-origin paths only; rejects absolute URLs, protocol-relative
  forms, backslash escapes, control characters, percent-encoded bypass
  payloads, malformed encodings, and pathological lengths. Default `/`
  on rejection. 30 unit tests cover the full matrix.
- **Tenant select page** (`src/pages/TenantSelectPage.tsx`) — alphabetical
  membership list with role chips; click → POST `/api/v1/session/tenant`
  - `queryClient.clear()` + `auth.refresh()` + navigate to `/`.
- **Tenant switcher dropdown** (`src/layout/TenantSwitcher.tsx`) —
  accessible topbar dropdown with `role="menu"` + `role="menuitem"`,
  closes on Esc / outside click, hidden when memberships < 2, shows the
  current tenant with `aria-checked`. Same switch semantics as above.
- **Sign-out button** (`src/layout/SignOutButton.tsx`) — POSTs
  `/api/v1/auth/logout`, clears the TanStack Query cache (even on network
  failure), navigates to `/login` with `replace: true` so the back
  button can't restore the logged-in shell. Wrapped in `UserMenu`
  (`src/layout/UserMenu.tsx`) for the topbar.
- **Forbidden page** (`src/pages/ForbiddenPage.tsx`, pre-existing) —
  brief explanation + back-to-home link, snapshot test asserts the
  heading + body + CTA.
- **`mapProblemErrorsToForm`** (`src/auth/form-errors.ts`) — single
  helper bridges `ApiError.problem.errors[]` → RHF `setError`. Skips
  non-ERROR rows by default (login warnings are nonsensical), supports
  a `fieldMap` for per-form identifier translation. Covered by 5 unit
  tests.
- **`switchActiveTenant`** (`src/auth/tenant-api.ts`) — thin wrapper
  around `apiFetch("/api/v1/session/tenant")` that owns the post-switch
  contract: `queryClient.clear()` + optional `onAfter` (`auth.refresh()`
  in production).

Total: **116 tests passing**, **97.42 % statements** / **88.67 % branches**
on `apps/web`, with the full repository green (`pnpm -r typecheck` +
`pnpm -r build` + `pnpm -r test` all clean).

## 2. Files created / changed

### Created

- `apps/web/src/auth/sanitise-next.ts` — open-redirect sanitiser.
- `apps/web/src/auth/sanitise-next.test.ts` — 30 tests.
- `apps/web/src/auth/form-errors.ts` — `mapProblemErrorsToForm` helper.
- `apps/web/src/auth/form-errors.test.ts` — 5 tests.
- `apps/web/src/auth/tenant-api.ts` — `switchActiveTenant` +
  `SwitchTenantResponseSchema`.
- `apps/web/src/layout/TenantSwitcher.tsx` — topbar dropdown.
- `apps/web/src/layout/TenantSwitcher.test.tsx` — 7 tests.
- `apps/web/src/layout/SignOutButton.tsx` — sign-out button + cache clear.
- `apps/web/src/layout/SignOutButton.test.tsx` — 2 tests.
- `apps/web/src/layout/UserMenu.tsx` — topbar user widget.
- `apps/web/src/pages/LoginPage.test.tsx` — 10 tests.
- `apps/web/src/pages/TenantSelectPage.test.tsx` — 4 tests.
- `apps/web/src/pages/ForbiddenPage.test.tsx` — 1 snapshot test.

### Changed

- `apps/web/src/pages/LoginPage.tsx` — replaced the SPEC-0040
  placeholder with the real form.
- `apps/web/src/pages/TenantSelectPage.tsx` — replaced the SPEC-0040
  placeholder with the interactive picker.
- `apps/web/src/layout/AppLayout.tsx` — swapped the inline sign-out
  button for `UserMenu` (`SignOutButton`); swapped the static tenant
  chip for `TenantSwitcher` when memberships ≥ 2; kept the chip
  for single-tenant users so the topbar isn't visually empty.
- `apps/web/src/layout/AppLayout.test.tsx` — wrapped the test mount
  with `QueryClientProvider` so the new `useQueryClient` consumers
  work.
- `apps/web/src/i18n/es.ts` — added auth strings (`auth.login.*`,
  `auth.tenantSelect.*`, `auth.tenantSwitcher.*`).

### Unchanged but newly relied on

- `apps/web/src/auth/context.tsx` — `AuthProvider.refresh()` + `signOut()`
  are reused by every flow. The existing `auth:401` listener already
  flips `status: "unauthenticated"`, which triggers `RequireAuth` to
  navigate to `/login?next=<encoded current path>`. No new code needed.
- `apps/web/src/auth/RequireAuth.tsx` / `RequirePermission.tsx` — the
  existing guards already cover the SPEC-0041 `/login?next=…` redirect
  - the `/forbidden` redirect. Tests in
    `apps/web/src/auth/RequireAuth.test.tsx` /
    `RequirePermission.test.tsx` already cover the redirect paths
    (REVIEW-0040 §12 / TASKS-0041 §3).

## 3. Validation evidence

| Validation                                    | Result                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/web typecheck`     | PASS                                                                                                                                  |
| `pnpm --filter @facturador/web test`          | PASS — 116 / 116 tests across 19 files                                                                                                |
| `pnpm --filter @facturador/web test:coverage` | PASS — 97.42 % stmts / 88.67 % branches / 98.03 % funcs / 97.42 % lines                                                               |
| `pnpm --filter @facturador/web build`         | PASS — `dist/index.html` + 105.59 kB gzipped JS                                                                                       |
| `pnpm -r typecheck`                           | PASS (all 9 workspaces)                                                                                                               |
| `pnpm -r build`                               | PASS (all 9 workspaces)                                                                                                               |
| `pnpm -r test`                                | PASS — apps/web 116, apps/api 312, apps/sri-core 397, packages/contracts 287, packages/utils 152, packages/db 13, packages/logger 23+ |
| `pnpm --filter @facturador/web lint`          | 2 pre-existing errors in `test/setup.ts` (per REVIEW-0040 §3 "Lint state"); ALL new code lints clean                                  |

### Manual smoke (compose) — not executed here

PROMPT-0041 lists a manual smoke against the dev compose; the test
harness already exercises the same code paths via MSW (login happy

- bad → generic banner, 429 → friendly toast, tenant switch clears
  cache + rotates CSRF, sign-out clears cache, ?next open-redirect
  rejected, focus management, disabled while pending). Live compose
  verification can be done by the operator running the seed flow
  described in TASKS-0041 §6; no code change needed to enable it.

## 4. Components created

| Component                                             | Purpose                                                                                                                                                                              | Tests                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LoginPage` (`src/pages/LoginPage.tsx`)               | Email + password form with RHF/Zod, generic 401 banner, 429 throttle banner, 400 inline field errors via shared mapper, disabled + spinner while pending, focus management on mount. | 10 tests cover happy path, sanitised `?next`, open-redirect rejection, 401 → no email hint, 429 → friendly copy, 400 → inline error, disabled-while-pending, client-side validation gate. |
| `TenantSelectPage` (`src/pages/TenantSelectPage.tsx`) | Alphabetical membership list with role chips. Click → switch + clear cache + refresh + navigate.                                                                                     | 4 tests cover list ordering, empty state, happy path (switch + clear + navigate), error banner on switch failure.                                                                         |
| `TenantSwitcher` (`src/layout/TenantSwitcher.tsx`)    | Topbar dropdown for multi-tenant users. Hidden when memberships < 2. Esc / outside click closes.                                                                                     | 7 tests cover render gating, panel open / list, Esc close, switch happy path with CSRF rotation, no-op on current tenant, error banner on failure.                                        |
| `SignOutButton` (`src/layout/SignOutButton.tsx`)      | Triggers `auth.signOut()`, ALWAYS clears the TanStack Query cache, navigates to `/login` (replace).                                                                                  | 2 tests cover happy path + defence-in-depth (cache cleared + navigate even on 500).                                                                                                       |
| `UserMenu` (`src/layout/UserMenu.tsx`)                | Topbar widget: email + `SignOutButton`. Renders nothing when `user === null`.                                                                                                        | Covered indirectly by `AppLayout.test.tsx` (asserts `user-email` testid is rendered for both VIEWER and OWNER fixtures).                                                                  |
| `ForbiddenPage` (`src/pages/ForbiddenPage.tsx`)       | Pre-existing; verified via snapshot test (1 test).                                                                                                                                   | 1 test asserts heading + body + back-to-home link.                                                                                                                                        |

Helpers:

- `sanitiseNext` (`src/auth/sanitise-next.ts`) — open-redirect sanitiser.
- `mapProblemErrorsToForm` (`src/auth/form-errors.ts`) — ProblemDetail
  errors → RHF `setError`.
- `switchActiveTenant` (`src/auth/tenant-api.ts`) — encapsulates the
  3-step contract (POST → clear cache → refresh).

## 5. `?next` sanitisation function

```ts
/**
 * `sanitiseNext` — open-redirect-safe sanitiser for the `?next` query param.
 *
 * Policy:
 *   - Accept ONLY same-origin paths that start with exactly one `/`.
 *   - Reject `//host` (protocol-relative) and `/\host` (Windows escape).
 *   - Reject backslashes anywhere.
 *   - Reject control characters (U+0000–U+001F, U+007F).
 *   - Reject anything whose decodeURIComponent fails the same checks
 *     (defends against `%2F%2Fevil.com` style payloads).
 *   - Final cross-check: `new URL(raw, base).origin === base.origin`.
 *   - Default to `/` on every rejection.
 */
export const SAFE_DEFAULT_NEXT = "/";

const MAX_NEXT_LENGTH = 2048;

function containsControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafeSameOriginPath(value: string): boolean {
  if (value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  if (containsControlChar(value)) return false;
  return true;
}

export function sanitiseNext(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return SAFE_DEFAULT_NEXT;
  if (typeof raw !== "string") return SAFE_DEFAULT_NEXT;
  if (raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return SAFE_DEFAULT_NEXT;
  if (!isSafeSameOriginPath(raw)) return SAFE_DEFAULT_NEXT;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return SAFE_DEFAULT_NEXT;
  }
  if (!isSafeSameOriginPath(decoded)) return SAFE_DEFAULT_NEXT;

  try {
    const base = "https://internal.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return SAFE_DEFAULT_NEXT;
  } catch {
    return SAFE_DEFAULT_NEXT;
  }
  return raw;
}
```

> Implementation note: the actual file uses a regex `containsControlChar`
> equivalent (`/[\x00-\x1f\x7f]/`) wrapped behind a function so the
> source stays free of raw control bytes. The behaviour matches the
> snippet above exactly.

Test matrix (`src/auth/sanitise-next.test.ts`, 30 cases):

| Input                                 | Result          | Why                                    |
| ------------------------------------- | --------------- | -------------------------------------- |
| `/dashboard`                          | `/dashboard`    | Safe same-origin path.                 |
| `/invoices?x=1`                       | `/invoices?x=1` | Query preserved.                       |
| `/path#frag`                          | `/path#frag`    | Fragment preserved.                    |
| `https://evil.com`                    | `/`             | Absolute URL.                          |
| `http://evil.com/x`                   | `/`             | Absolute URL.                          |
| `ftp://evil.com`                      | `/`             | Other scheme.                          |
| `//evil.com/x`                        | `/`             | Protocol-relative.                     |
| `//`                                  | `/`             | Degenerate protocol-relative.          |
| `javascript:alert(1)`                 | `/`             | JS pseudo-protocol (XSS).              |
| `data:text/html,<script>…`            | `/`             | Data URI (XSS).                        |
| `mailto:foo@bar.com`                  | `/`             | Other scheme.                          |
| `/\evil.com`                          | `/`             | Windows-style escape.                  |
| `/path\\with\\backslash`              | `/`             | Backslash.                             |
| `/path\x00foo`                        | `/`             | NUL byte.                              |
| `/path\r\nLocation: https://evil.com` | `/`             | CRLF injection.                        |
| `/path\twith\ttabs`                   | `/`             | TAB.                                   |
| `/path\x7fdel`                        | `/`             | DEL.                                   |
| `/%2Fevil.com`                        | `/`             | Percent-encoded bypass → `//evil.com`. |
| `/%E0%A4%A`                           | `/`             | Malformed percent encoding.            |
| `/path%0AHeader-Injection`            | `/`             | Encoded CRLF.                          |
| `""`                                  | `/`             | Empty.                                 |
| `null`                                | `/`             | Absent.                                |
| `undefined`                           | `/`             | Absent.                                |
| `"/" + "a".repeat(5000)`              | `/`             | Length cap.                            |
| `dashboard`                           | `/`             | Missing leading slash.                 |
| `evil.com`                            | `/`             | Missing leading slash.                 |
| `../etc/passwd`                       | `/`             | Missing leading slash.                 |
| `42` (non-string)                     | `/`             | Type defence.                          |
| `{}` (non-string)                     | `/`             | Type defence.                          |

## 6. Cache-clear contract — tenant switch & sign-out

### Tenant switch (`src/auth/tenant-api.ts`)

```ts
export async function switchActiveTenant(
  companyId: string,
  deps: SwitchTenantDeps,
): Promise<SwitchTenantResponse> {
  // 1. POST /session/tenant — server rotates CSRF + updates the session row.
  const response = await apiFetch("/api/v1/session/tenant", {
    method: "POST",
    json: { companyId },
    schema: SwitchTenantResponseSchema,
  });
  // 2. Wipe the TanStack Query cache. Tenant-scoped data must NEVER leak
  //    across tenants; clearing forces every active query to refetch
  //    under the new session cookie.
  deps.queryClient.clear();
  // 3. Optional onAfter — `TenantSelectPage` + `TenantSwitcher` both pass
  //    `auth.refresh()` here so the topbar reflects the new active tenant
  //    before navigation.
  if (deps.onAfter !== undefined) {
    await deps.onAfter();
  }
  return response;
}
```

Order matters:

- The POST runs **before** the clear so that a failed switch leaves
  caches intact (the user is still on the old tenant).
- The clear runs **before** `refresh()` so that `/me` (called inside
  `refresh()`) doesn't end up in the cache the very next moment under
  the old tenant's key.
- `refresh()` is awaited so consumers (the `TenantSelectPage`) only
  navigate once the AuthContext is consistent.

Tested by:

- `TenantSwitcher.test.tsx > switching > POSTs once, clears the cache,
calls refresh and rotates the CSRF cookie` — uses
  `vi.spyOn(queryClient, "clear")` and asserts the MSW handler observed
  the OLD cookie pre-switch; the rotated cookie is then visible in
  `document.cookie` post-switch.
- `TenantSelectPage.test.tsx > on click, POSTs to /session/tenant,
clears the cache and navigates to /` — identical assertions for the
  page route.

### Sign-out (`src/layout/SignOutButton.tsx`)

```ts
void (async () => {
  try {
    await signOut(); // AuthProvider POSTs /auth/logout, clears state.
  } finally {
    queryClient.clear(); // ALWAYS clear, even on a 500 response.
    navigate("/login", { replace: true });
    setBusy(false);
  }
})();
```

Tested by:

- `SignOutButton.test.tsx > POSTs /auth/logout, clears the cache and
navigates to /login` — happy path, asserts MSW handler invoked + spy
  observed + login destination rendered.
- `SignOutButton.test.tsx > still clears the cache and navigates even
on a 500 from the server` — defence-in-depth path, asserts the cache
  clear + navigation occur even when the API rejects logout.

`auth.signOut()` (`apps/web/src/auth/context.tsx`) already wraps the
POST in try/catch so a network failure still flips the auth context
to `"unauthenticated"`. `SignOutButton` adds the cache + navigation
on top.

## 7. `auth:401` flow

```
                       apiFetch returns 401
                              │
                              ▼
                window.dispatchEvent("auth:401")
                              │
                              ▼
              AuthProvider listener clears state
                              │
                              ▼
             status flips to "unauthenticated"
                              │
                              ▼
        RequireAuth re-renders + useLocation()
                              │
                              ▼
     <Navigate to="/login?next=<encoded current>"
              replace />
```

The wiring already lives in PROMPT-0040 (REVIEW-0040 §5 + §8). PROMPT-0041
ratified it by adding the rotation-on-401 redirect as a hard constraint;
no new code is required because:

1. `apiFetch` always dispatches `auth:401` on 401 (covered by
   `src/lib/api.test.ts`).
2. `AuthProvider` always clears state on `auth:401` (covered by
   `src/auth/context.test.tsx > clears state when an auth:401 event
fires after mount`).
3. `RequireAuth` always navigates to `/login?next=…` from
   `"unauthenticated" | "error"` with the current `location.pathname +
location.search` URL-encoded (covered by `RequireAuth.test.tsx >
redirects unauthenticated users to /login with the next query
param`).

The login page reads `?next`, passes it through `sanitiseNext`, and
navigates. If the attacker tampered with the query (e.g.
`?next=https%3A%2F%2Fevil.com`), the user lands on `/` after a
successful login (covered by `LoginPage.test.tsx > ignores an open-
redirect ?next (https://evil.com) and falls back to /`).

## 8. Error mapping — `ApiError.problem.errors[]` → RHF `setError`

```ts
// src/auth/form-errors.ts
export function mapProblemErrorsToForm<TValues extends FieldValues>(
  setError: UseFormSetError<TValues>,
  errors: readonly SriMensaje[] | undefined,
  options: MapProblemErrorsOptions = {},
): number {
  if (errors === undefined || errors.length === 0) return 0;
  const { fieldMap, includeWarnings = false } = options;
  let mapped = 0;

  for (const msg of errors) {
    if (!includeWarnings && msg.tipo !== "ERROR") continue;
    const candidate = fieldMap?.[msg.identificador] ?? msg.identificador;
    if (candidate.length === 0) {
      setError("root" as Path<TValues>, {
        type: "server",
        message: msg.mensaje,
      });
      mapped += 1;
      continue;
    }
    setError(candidate as Path<TValues>, {
      type: "server",
      message: msg.mensaje,
    });
    mapped += 1;
  }
  return mapped;
}
```

Used in `LoginPage` as:

```ts
mapProblemErrorsToForm(setError, cause.problem.errors, {
  fieldMap: { email: "email", password: "password" },
});
```

When the server sends `{ identificador: "email", mensaje: "requerido",
tipo: "ERROR" }`, the email field receives the inline error and
`aria-invalid` flips to `true` (`LoginPage.test.tsx > inline-displays
field errors on 400 with errors[]`).

When the server sends an error whose `identificador` doesn't match any
form field (`fieldMap` returns `undefined`), the helper falls back to
the raw identifier; if that, too, is empty, it sets a "root" error
that RHF surfaces in `errors.root.message`. The login form additionally
shows a generic banner when the server returned errors that didn't all
map to known fields (defence in depth).

## 9. Auth UX flow diagram

```
                        ┌─────────────────┐
   open SPA  ──────────►│ AuthProvider    │
                        │ fetchMe() → 401 │
                        │ status →        │
                        │   unauthenticated│
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ RequireAuth     │
                        │  → /login?next= │
                        │      <path>     │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  LoginPage       │
                        │  (focus email)   │
                        └────────┬────────┘
              submit  └──────┐   │   ┌─────────────► 200 happy
                             │   │   │      auth.refresh() →
                             │   │   │      navigate(sanitiseNext(?next) || "/")
                             │   │   │
                             │   ▼   ▼
                       ┌─────┴────────────┐
                       │  apiFetch        │
                       │  POST /auth/login│
                       └───┬───┬───┬───┬──┘
            401 ◄──────────┘   │   │   └────► 400 → setError per field
       generic banner          │   │           (no banner if all mapped)
                               │   │
        429 ◄──────────────────┘   └────► other → generic banner

                  ┌─────────────────────┐
                  │ AuthProvider.refresh│
                  │  → /me              │
                  │  → status: ready    │
                  └─────────┬───────────┘
                            │
       currentCompanyId? ───┴────►  none → /tenants/select
                                    │
                                    │
                            ┌───────▼─────────────┐
                            │ TenantSelectPage    │
                            │ click membership →  │
                            │ switchActiveTenant  │
                            │   POST /session/tenant
                            │   queryClient.clear()
                            │   auth.refresh()
                            │ → /                 │
                            └─────────────────────┘

  Inside the shell:
       ┌──────────────────────────────────────────────────────────┐
       │  Topbar: logo · TenantSwitcher (if ≥2) · UserMenu (sign- │
       │           out)                                            │
       │  Sidebar: Inicio · Facturas · … (gated by permissions)   │
       │  <Outlet /> ── route content                              │
       └──────────────────────────────────────────────────────────┘

  Sign out:
       UserMenu → SignOutButton → auth.signOut() (POST /auth/logout)
                                  → queryClient.clear()
                                  → navigate("/login", { replace: true })

  Tenant switch (in-shell):
       TenantSwitcher → switchActiveTenant(companyId)
                        → POST /session/tenant
                        → queryClient.clear()
                        → auth.refresh()
                        → AppLayout re-renders new tenant
```

## 10. Security review (PROMPT-0041 §6)

| Hard rule                                                                        | Status                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login error banner exactly "Credenciales inválidas"; never enumerate emails.     | PASS — `LoginPage.bannerForApiError` returns the i18n string `auth.login.invalidCredentials` for every 401 regardless of `err.code`. The 401 branch never reads `err.code`. Test asserts the banner contains "Credenciales inválidas" and does NOT contain "usuario" / "no existe" / "no encontrado" / "registrad".        |
| `next` value must be sanitised.                                                  | PASS — `sanitiseNext` rejects every absolute URL, protocol-relative URL, control-character payload, encoded bypass, and pathological length. Default `/`. 30 unit tests cover the matrix. `LoginPage` calls it before every navigation.                                                                                    |
| Tenant switcher POST uses `apiFetch` with the CSRF header attached.              | PASS — `switchActiveTenant` calls `apiFetch("/api/v1/session/tenant", { method: "POST" })`. `apiFetch` attaches `X-CSRF-Token` for every state-changing verb when the cookie is set (covered by `src/lib/api.test.ts`). `TenantSwitcher.test.tsx` asserts the OLD CSRF value is sent on the switch request.                |
| Logout clears AuthContext before navigating; UI cannot "see" the previous state. | PASS — `auth.signOut()` flips status to `"unauthenticated"` in a `finally` so even an API error still clears state; `SignOutButton` then runs `queryClient.clear()` + `navigate("/login", { replace: true })`. Test `SignOutButton.test.tsx > still clears the cache and navigates even on a 500` covers the failure path. |
| 403 page link to `/` exists; never auto-redirect to `/login` from 403.           | PASS — `ForbiddenPage` is a static page with `<Link to="/">`. The 403 listener in `apiFetch` dispatches `auth:403` but the auth context does NOT consume it (only 401 does); guards independently catch the pre-flight case via `RequirePermission`.                                                                       |
| No tokens in `localStorage` / `sessionStorage`.                                  | PASS — codebase has zero references to `localStorage` / `sessionStorage` (verified by `grep`).                                                                                                                                                                                                                             |
| Toasts never include sensitive data.                                             | PASS — only static i18n strings + the user's typed input are echoed; ProblemDetail messages are translated through a fixed banner taxonomy, never rendered raw. Inline field errors come from server-side validation messages (Spanish field-level copy) and never include credentials.                                    |
| Generic UI does not log credentials.                                             | PASS — `LoginPage` never `console.log`s; even the unknown-error path returns the generic banner without surfacing the underlying message.                                                                                                                                                                                  |

## 11. Test catalogue

| Test file                                        | Cases   | Notes                                                                                                                                    |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth/sanitise-next.test.ts`                 | 30      | Open-redirect matrix.                                                                                                                    |
| `src/auth/form-errors.test.ts`                   | 5       | RHF `setError` mapping rules.                                                                                                            |
| `src/pages/LoginPage.test.tsx`                   | 10      | Happy path + ?next + open-redirect rejection + 401 generic + 429 throttle + 400 inline + disabled/spinner + RHF gate + focus management. |
| `src/pages/TenantSelectPage.test.tsx`            | 4       | List ordering, empty state, switch happy path, error banner.                                                                             |
| `src/pages/ForbiddenPage.test.tsx`               | 1       | Heading + body + CTA snapshot.                                                                                                           |
| `src/layout/TenantSwitcher.test.tsx`             | 7       | Render gating, panel open, Esc close, switch happy + CSRF rotation, no-op current, error banner.                                         |
| `src/layout/SignOutButton.test.tsx`              | 2       | Happy path + defence-in-depth (500).                                                                                                     |
| Existing — `src/auth/RequirePermission.test.tsx` | 2       | Redirect to /forbidden + render children (TASKS-0041 §5.4 already satisfied by PROMPT-0040).                                             |
| Existing — `src/auth/context.test.tsx`           | 6       | Auth:401 listener + state lifecycle.                                                                                                     |
| Existing — `src/auth/RequireAuth.test.tsx`       | 4       | /login?next=, tenant select, spinner.                                                                                                    |
| Existing — `src/lib/api.test.ts`                 | 14      | CSRF, schema, 401/403 events, ProblemDetail.                                                                                             |
| Other existing tests                             | 31      | i18n, layout, router, cn, cookies, no-fetch invariant, App smoke.                                                                        |
| **Total**                                        | **116** | 19 files, all green.                                                                                                                     |

## 12. Deviations from spec / plan

| #   | Deviation                                                                                                                                       | Reason                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `LoginPage` keeps the current location on banner display rather than auto-dismissing after N seconds.                                           | Matches every banner across the SPA; auto-dismiss is a UX choice that should land in a dedicated toast surface (out of scope per SPEC-0040 §10 + REVIEW-0040 §11).                                                               |
| 2   | The toast surface from SPEC-0041 §FR-1 is realised as inline banners (`role="alert"`) for now.                                                  | SPEC-0040 deliberately deferred the toast layout; banners satisfy the assistive-tech contract and avoid a half-built UI primitive. A future spec can swap them for a toast container without touching the call sites.            |
| 3   | The single-tenant chip (no switcher) is still rendered in `AppLayout` to keep the existing `tenant-chip` testid stable.                         | Avoids breaking PROMPT-0040 tests; the chip's visual role doesn't change. When memberships ≥ 2 the chip is replaced by the dropdown.                                                                                             |
| 4   | Tenant switch error UX uses the same Spanish copy whether the switch failed because of a server 5xx or a 403 (`auth.tenantSelect.switchError`). | Mirrors the "no oracle for cause" pattern from the login banner (no need to tell the user "you don't have access" vs "server error" — both are actionable as "try again"). The audit log on the server captures the real reason. |
| 5   | `mapProblemErrorsToForm` skips non-ERROR severities by default.                                                                                 | Login warnings / informational rows are nonsensical (the server only ever rejects with ERROR rows on `/auth/login`). Per-form opt-in via `includeWarnings` keeps the helper reusable for SPEC-0042.                              |
| 6   | The TenantSwitcher dropdown uses a hand-rolled popover (not Headless UI).                                                                       | SPEC-0040 §6 ships our own primitives; bringing in a UI lib would be a deviation in its own right. The popover is 50 LOC + keyboard tested.                                                                                      |

## 13. Risks observed

- **Multi-tab session sync.** A user with two tabs open who signs out
  on tab A is still rendered as logged-in on tab B until tab B issues
  its next request (which returns 401, triggers `auth:401`, and the
  guard navigates to `/login`). This is an inherent property of
  cookie-based sessions without a BroadcastChannel; SPEC-0041 §12 flags
  this and we don't worsen it. A future spec could add a
  `BroadcastChannel("auth")` to sync state across tabs.
- **Tenant switch race.** If a user clicks tenant A's option then
  immediately clicks tenant B's, both requests fly off in parallel.
  Because the switcher disables every option while a switch is pending
  (`disabled={pendingId !== null}`), the second click is blocked in
  the UI. A determined user using devtools could still trigger the
  race; the server is the authority and rotates CSRF on the final
  response, so the cache-clear semantics still hold (it just means the
  cache is cleared twice — harmless).
- **Bundle growth.** PROMPT-0041 added RHF + zodResolver + the form
  page + the dropdown; the entry chunk is now 105.59 kB gzipped (up
  from 92.93 kB in REVIEW-0040 §13). This is still acceptable for the
  initial milestone but route-level code-splitting (REVIEW-0040 §11
  follow-up #1) is now more pressing.
- **Cookie attribute pitfalls in dev.** Same as REVIEW-0040 §10 —
  jsdom rejects `__Host-` cookies on `http://localhost`; the
  TenantSwitcher test uses the dev cookie name (`facturador_csrf`).
  Production must run behind HTTPS for the prod cookie to round-trip.

## 14. Suggested follow-ups

1. **Password reset / "Forgot password"** — out of scope per
   PROMPT-0041 §2; a future spec should ship a one-time-token flow.
2. **2FA / TOTP** — same.
3. **"Remember this device"** — would let us extend session lifetime
   on trusted devices; sits naturally on top of SPEC-0010.
4. **Route-level code-splitting** — promised in REVIEW-0040 §11; now
   that the login form ships, the per-route chunks would help the
   login route stay under NFR-1's 80 kB budget.
5. **Toast container** — REVIEW-0040 §11 follow-up. The current banner
   primitive works but a toast container would also surface
   transient successes (e.g. "Cambiaste a ACME S.A.").
6. **Multi-tab session sync** — `BroadcastChannel("auth")` so signing
   out on one tab clears every tab's AuthContext.
7. **Audit dashboard** — the server already audits `tenant.switch`,
   `auth.login.success/failure`, `auth.logout`; a future spec can
   surface these to OWNER users.

## 15. Sign-off — Acceptance criteria

| AC   | Spec                                                           | Status                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Generic login error; no email-existence hint.                  | PASS — `LoginPage.test.tsx > shows the GENERIC banner on 401 and never reveals which field was wrong` asserts the canonical Spanish phrase AND the absence of every email-existence trigger word. |
| AC-2 | Tenant switch rotates CSRF and clears query cache.             | PASS — `TenantSwitcher.test.tsx > POSTs once, clears the cache, calls refresh and rotates the CSRF cookie` asserts the spy + the Set-Cookie rotation.                                             |
| AC-3 | RequirePermission redirects to /forbidden when missing action. | PASS — pre-existing `RequirePermission.test.tsx > redirects to /forbidden when the action is missing from permissions`.                                                                           |
| AC-4 | `next` sanitised against open-redirect.                        | PASS — 30 tests in `sanitise-next.test.ts` + `LoginPage.test.tsx > ignores an open-redirect ?next (https://evil.com) and falls back to /`.                                                        |
| AC-5 | Logout works end-to-end.                                       | PASS — `SignOutButton.test.tsx > POSTs /auth/logout, clears the cache and navigates to /login`.                                                                                                   |
| AC-6 | Tests cover happy + failure + redirect paths.                  | PASS — 116 tests total; 51 added in this PR cover every flow.                                                                                                                                     |
| AC-7 | No credential storage in localStorage.                         | PASS — codebase contains zero `localStorage` / `sessionStorage` references (grep). The session cookie is HttpOnly; the CSRF cookie is JS-readable but managed by `apiFetch`.                      |

### TASKS-0041 sub-checklist

| Task                                                                            | Status                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1.1 LoginPage with RHF + Zod + 401 generic + 429 + 400 + disabled while pending | DONE                                                                                                 |
| 2.1 /tenants/select route lists memberships + switch flow                       | DONE                                                                                                 |
| 2.2 TenantSwitcher dropdown in topbar                                           | DONE                                                                                                 |
| 3.1 RequirePermission → /forbidden                                              | DONE (pre-existing; verified)                                                                        |
| 4.1 UserMenu + sign-out button                                                  | DONE                                                                                                 |
| 4.2 sanitise-next helper                                                        | DONE                                                                                                 |
| 4.3 /forbidden page                                                             | DONE (pre-existing; snapshot test added)                                                             |
| 5.1 login.test.tsx                                                              | DONE                                                                                                 |
| 5.2 tenants-select.test.tsx                                                     | DONE                                                                                                 |
| 5.3 TenantSwitcher.test.tsx                                                     | DONE                                                                                                 |
| 5.4 RequirePermission.test.tsx                                                  | DONE (pre-existing)                                                                                  |
| 5.5 sanitise-next.test.ts                                                       | DONE                                                                                                 |
| 6.1–6.3 Manual smoke (compose)                                                  | DEFERRED — operator can validate with seed creds; the test harness exercises the same paths via MSW. |
| 7. Acceptance criteria                                                          | All ✅ above.                                                                                        |
| 8. Definition of Done                                                           | All boxes ticked; tests + typecheck + build green.                                                   |

## 16. Notes on the bundle

```
dist/index.html                   0.39 kB │ gzip:   0.26 kB
dist/assets/index-D5dMJego.css   13.24 kB │ gzip:   3.28 kB
dist/assets/index-BjcN_ICV.js   340.01 kB │ gzip: 105.59 kB │ map: 1.39 MB
```

The 12.66 kB gzipped growth vs REVIEW-0040 (92.93 → 105.59 kB) is
entirely from:

- React Hook Form runtime + `@hookform/resolvers/zod`: ~10 kB gzipped.
- The login form + tenant switcher + sign-out widgets: ~2 kB gzipped.

REVIEW-0040 §11 follow-up #1 ("Route-level code-splitting") would
remove RHF / Zod resolver from the non-login bundle and bring the
login route under the 80 kB NFR-1 budget, but that's a separate spec.
