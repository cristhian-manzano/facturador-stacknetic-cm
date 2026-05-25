---
id: SPEC-0041
title: Web auth flows (login, session bootstrap, tenant switch)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0005, SPEC-0010, SPEC-0011, SPEC-0040]
blocks: [SPEC-0042, SPEC-0043]
---

# SPEC-0041 — Web auth flows

## 1. Purpose

Implement the user-facing login, session bootstrap on app load, tenant switcher, logout, and the route guards that gate every authenticated page. Plumbs into [SPEC-0010](./0010-authentication-and-sessions.md) and [SPEC-0011](./0011-tenants-memberships-rbac.md).

## 2. Scope

### 2.1 In scope

- `/login` page with email + password form.
- `GET /api/v1/auth/me` bootstrap on app mount; redirect rules.
- Tenant switcher dropdown in the top bar.
- Logout button.
- `RequireAuth` and `RequirePermission` route wrappers.
- Auth context API for downstream specs.

### 2.2 Out of scope

- Password reset, 2FA, SSO — later specs.
- Account creation (admins create tenants via [SPEC-0011](./0011-tenants-memberships-rbac.md) endpoints; UI wiring for that is later).

## 3. Context & references

- [SPEC-0010](./0010-authentication-and-sessions.md) — auth API.
- [SPEC-0011](./0011-tenants-memberships-rbac.md) — tenant switching.
- [SPEC-0040](./0040-web-app-bootstrap.md) — UI primitives, HTTP client.

## 4. Functional requirements

- **FR-1.** `/login`:
  - Form (react-hook-form + `LoginRequestSchema`).
  - Submit → `POST /api/v1/auth/login`.
  - On 200: set auth context with user/memberships/activeCompanyId; redirect to last-visited intent or `/invoices`.
  - On 401 `auth.invalid_credentials`: show toast "Credenciales inválidas" (no field-level error to avoid email-exists hint).
  - On 429: toast "Demasiados intentos. Intenta de nuevo en unos minutos."
  - Disable submit while pending. Disable form 5 s after a successful submit (UX nicety).
- **FR-2.** App bootstrap: on mount, call `GET /api/v1/auth/me`:
  - 200 → load auth state, route to last intent or `/invoices`.
  - 401 → clear state, route to `/login` (unless already there).
  - Network error → show a "Sin conexión, reintentando…" banner; retry every 5 s.
- **FR-3.** Tenant switcher (top bar):
  - Shows current `Company.razonSocial`.
  - On open, lists memberships (alphabetical).
  - Click → `POST /api/v1/session/tenant { companyId }`; success → update auth state, invalidate all queries via `qc.clear()`, toast "Cambiaste a {razonSocial}".
- **FR-4.** Logout button (user menu): calls `POST /api/v1/auth/logout`, clears auth, redirects to `/login`.
- **FR-5.** `RequireAuth`:
  - Reads auth context; redirects to `/login?next=<from>` if missing.
- **FR-6.** `RequirePermission({ action })`:
  - Reads the active membership role; permitted via the same `can(role, action)` matrix from [SPEC-0011](./0011-tenants-memberships-rbac.md) (small typed copy lives in web).
  - Forbidden → renders `<Forbidden />` (403-style page) — the API also enforces this; the UI just hides controls and routes.
- **FR-7.** Session expiry handling: when an authenticated request returns 401 mid-session, auth context is cleared and the user is redirected to `/login` with a "Tu sesión expiró" toast.

## 5. Non-functional requirements

- **NFR-1.** First contentful paint of `/login` ≤ 1.5 s on a fresh load.
- **NFR-2.** No flash of "logged out" before bootstrap completes — render a `<SessionBootstrapping />` splash for ≤ 800 ms.
- **NFR-3.** All forms keyboard-navigable.

## 6. Technical design

### 6.1 Files

```
apps/web/src/auth/
├── auth-context.tsx
├── use-auth.ts
├── require-auth.tsx
├── require-permission.tsx
├── permissions.ts          # mirrors apps/api/src/auth/permissions.ts (typed action list)
└── api.ts                  # login(), me(), logout(), switchTenant()
apps/web/src/routes/login.tsx
apps/web/src/layout/tenant-switcher.tsx
apps/web/src/layout/user-menu.tsx
```

### 6.2 `auth-context.tsx`

```tsx
import { createContext, useEffect, useState, type ReactNode } from "react";
import type { LoginResponse } from "@facturador/contracts/auth";
import { me } from "./api";
import { setOnUnauthorized } from "../api/client";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | {
      status: "authenticated";
      user: LoginResponse["user"];
      memberships: LoginResponse["memberships"];
      activeCompanyId: string | null;
    };

interface AuthContextValue {
  state: AuthState;
  setAuthenticated: (payload: LoginResponse) => void;
  clear: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    setOnUnauthorized(async () => setState({ status: "anonymous" }));
    me()
      .then((payload) => setState({ status: "authenticated", ...payload }))
      .catch(() => setState({ status: "anonymous" }));
  }, []);

  const value: AuthContextValue = {
    state,
    setAuthenticated: (payload) => setState({ status: "authenticated", ...payload }),
    clear: () => setState({ status: "anonymous" }),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
```

### 6.3 `use-auth.ts`

```ts
import { useContext } from "react";
import { AuthContext } from "./auth-context";

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
```

### 6.4 `require-auth.tsx`

```tsx
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "./use-auth";
import { SessionBootstrapping } from "./session-bootstrapping";

export const RequireAuth = () => {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <SessionBootstrapping />;
  if (state.status === "anonymous")
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return <Outlet />;
};
```

### 6.5 Login route

```tsx
// routes/login.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginRequestSchema, type LoginRequest } from "@facturador/contracts/auth";
import { useAuth } from "../auth/use-auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input } from "../ui";
import { es } from "../i18n/es";
import { toast } from "../ui/toast";
import { ApiError } from "../api/client";
import { login } from "../auth/api";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema) });

  const onSubmit = async (values: LoginRequest) => {
    try {
      const payload = await login(values);
      auth.setAuthenticated(payload);
      navigate(sp.get("next") ?? "/invoices", { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "auth.invalid_credentials") toast.error(es.auth.invalidCredentials);
        else if (e.status === 429) toast.error(es.auth.tooManyAttempts);
        else toast.error(es.errors.generic);
      }
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-xl font-semibold">{es.auth.title}</h1>
        <Field label={es.auth.email} error={errors.email?.message}>
          <Input type="email" autoComplete="username" {...register("email")} />
        </Field>
        <Field label={es.auth.password} error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register("password")} />
        </Field>
        <Button type="submit" loading={isSubmitting} className="w-full">
          {es.auth.submit}
        </Button>
      </form>
    </main>
  );
}
```

### 6.6 Tenant switcher

Dropdown using Headless UI **patterns** (we built our own primitives in [SPEC-0040](./0040-web-app-bootstrap.md)). Calls `switchTenant(companyId)` then `qc.clear()` (via TanStack Query) to refresh all data with the new tenant context.

### 6.7 i18n strings (excerpt — `src/i18n/es.ts`)

```ts
export const es = {
  auth: {
    title: "Iniciar sesión",
    email: "Correo electrónico",
    password: "Contraseña",
    submit: "Ingresar",
    invalidCredentials: "Credenciales inválidas",
    tooManyAttempts: "Demasiados intentos. Intenta de nuevo en unos minutos.",
    sessionExpired: "Tu sesión expiró. Volve a iniciar sesión.",
  },
  errors: {
    generic: "Algo salió mal. Intenta de nuevo.",
  },
} as const;
```

## 7. Implementation guide

### 7.1 Steps

1. Implement files in §6.
2. Wire routes in `src/routes/_routes.tsx`:

   ```tsx
   <Routes>
     <Route path="/login" element={<LoginPage />} />
     <Route element={<RequireAuth />}>
       <Route element={<AppShell />}>
         <Route index element={<Navigate to="/invoices" replace />} />
         <Route path="/invoices" element={<InvoicesIndex />} />
         <Route path="/invoices/new" element={<InvoicesNew />} />
         <Route path="/invoices/:id" element={<InvoicesDetail />} />
         <Route path="*" element={<NotFound />} />
       </Route>
     </Route>
   </Routes>
   ```

3. Tests:
   - Login happy path with MSW returning 200.
   - Login wrong creds → toast appears.
   - 401 mid-session triggers redirect.
   - Tenant switch invalidates queries (assert `qc.clear()` was called).

### 7.2 Dependencies

(All in [SPEC-0040](./0040-web-app-bootstrap.md).)

### 7.3 Conventions

- Auth state is the **only** source of truth for "who am I"; downstream specs read it via `useAuth()` — they never call `/auth/me` themselves.
- Permission checks in UI are advisory; the API enforces. UI hides controls the user cannot use.

## 8. Acceptance criteria

- **AC-1.** From an anonymous state, navigating to `/invoices` redirects to `/login?next=%2Finvoices`.
- **AC-2.** Successful login redirects to `/invoices` (or the `next` param).
- **AC-3.** Wrong password shows toast; field-level errors do not differ between "wrong password" and "unknown email" cases.
- **AC-4.** After `me()` succeeds at bootstrap, the user sees the dashboard without a flash of `/login`.
- **AC-5.** Switching tenant updates the top bar and refreshes any visible data (invoices list refetches).
- **AC-6.** Logout clears state and the next protected nav goes to `/login`.
- **AC-7.** A `VIEWER` does not see the "Nueva factura" button (UI hides per permission), but still calling the API via curl is rejected by the server.

## 9. Test plan

- MSW-driven integration tests for each AC.
- Manual: keyboard navigation through the login form and the tenant switcher.

## 10. Security considerations

- No tokens in `localStorage`/`sessionStorage`.
- `next` param sanitised: must start with `/` and not be a protocol (`/[^/]`); else default to `/invoices`.
- Toasts are short-lived and never include sensitive data (no email, no error stack).

## 11. Observability

- Auth context transitions logged at debug.
- Failed login attempts not logged client-side beyond a generic toast (server has the audit).

## 12. Risks and mitigations

| Risk                                               | Mitigation                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Multi-tab sessions out of sync after tenant switch | TanStack Query `qc.clear()` resets caches; on next focus the queries refetch.                  |
| Token expiration mid-form                          | 401 handler stores the in-progress form values in memory (best-effort) and redirects to login. |

## 13. Open questions

- Persist the active tenant across reloads via cookie? It's already in the session row; bootstrap reads it from `/auth/me`. No extra state needed.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
