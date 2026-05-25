---
id: SPEC-0040
title: Web app bootstrap (Vite + React + TS)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002, SPEC-0003, SPEC-0005, SPEC-0006]
blocks: [SPEC-0041, SPEC-0042, SPEC-0043]
---

# SPEC-0040 — Web app bootstrap

## 1. Purpose

Set up the Vite + React + TypeScript app with a production-grade baseline: routing, layout shell, typed API client, query layer, design tokens, error boundaries, and accessibility scaffolding. Everything later UI specs need to plug into.

## 2. Scope

### 2.1 In scope

- Vite 5 project under `apps/web/`.
- React 18, React Router 6, TanStack Query v5.
- Shared design system: Tailwind CSS 3 + a minimal set of accessible primitives (Button, Input, Field, Stack, Card, Toast, Dialog). Built in-house — no full UI library dependency for v1 (we will not adopt MUI/AntD).
- HTTP client wrapper around `fetch` with CSRF header injection, JSON parsing, ProblemDetail handling, and abort signals.
- Auth context (skeleton) — implementation by [SPEC-0041](./0041-web-auth-flows.md).
- Type-safe routing tree.
- Application-level error boundary + toast surface.
- Spanish UI by default (no i18n library yet; strings centralised in `src/i18n/es.ts`).
- Env validation via Zod for `VITE_*` vars.

### 2.2 Out of scope

- Component library packaging (apps/web uses its own components; no `@facturador/ui` package).
- Storybook / Chromatic.
- Server-side rendering.

## 3. Context & references

- [SPEC-0005](./0005-shared-contracts.md) — schemas consumed in forms.
- [SPEC-0006](./0006-error-model-and-logging.md) — `ProblemDetail` shape returned by API.
- [`ai/context/security.md`](../context/security.md) — XSS/CSP concerns.

## 4. Functional requirements

- **FR-1.** Vite project structure:

  ```
  apps/web/
  ├── index.html
  ├── vite.config.ts
  ├── tsconfig.json
  ├── tailwind.config.ts
  ├── postcss.config.cjs
  ├── public/
  │   └── favicon.svg
  └── src/
      ├── main.tsx
      ├── App.tsx
      ├── env.ts                          # zod-validated
      ├── routes/                         # one file per route; co-located components
      │   ├── _layout.tsx
      │   ├── _auth-layout.tsx
      │   ├── login.tsx                   # SPEC-0041
      │   ├── invoices.index.tsx          # SPEC-0043
      │   ├── invoices.new.tsx            # SPEC-0042
      │   ├── invoices.$id.tsx
      │   └── not-found.tsx
      ├── api/
      │   ├── client.ts                   # fetch wrapper
      │   ├── csrf.ts
      │   ├── error.ts                    # parseProblemDetail
      │   └── hooks/                      # one per domain (auth, invoices, customers, ...)
      ├── auth/
      │   ├── auth-context.tsx
      │   └── require-auth.tsx
      ├── ui/
      │   ├── button.tsx
      │   ├── input.tsx
      │   ├── field.tsx
      │   ├── card.tsx
      │   ├── dialog.tsx
      │   ├── toast.tsx
      │   ├── stack.tsx
      │   └── icons.tsx
      ├── layout/
      │   ├── app-shell.tsx
      │   ├── topbar.tsx
      │   └── sidebar.tsx
      ├── error-boundary.tsx
      ├── i18n/
      │   └── es.ts
      └── styles/
          ├── globals.css
          └── tokens.css
  ```

- **FR-2.** Routing: React Router 6, code-split per route (lazy `import()`).
- **FR-3.** Query layer: `QueryClientProvider` configured with sensible defaults (`staleTime: 30s`, `refetchOnWindowFocus: false` for fiscal context — explicit refresh actions only).
- **FR-4.** HTTP client (`api/client.ts`):
  - Base URL: `VITE_API_BASE_URL`.
  - `credentials: "include"` for cookies.
  - Auto-attach `x-csrf-token` from cookie for state-changing methods.
  - On 401: clear auth state, redirect to login.
  - On 4xx/5xx: parse `ProblemDetail` and throw a typed `ApiError`.
- **FR-5.** Toast surface and modal Dialog are app-level (one provider near root).
- **FR-6.** Error boundary catches render errors → toast + "reload page" prompt; in dev shows stack.
- **FR-7.** Accessibility baseline: skip-to-main link; focus-visible styles; semantic landmarks (`<main>`, `<nav>`, `<header>`); `prefers-color-scheme` honoured but light mode is default.

## 5. Non-functional requirements

- **NFR-1.** Initial JS payload (login route) gzipped ≤ 80 KB.
- **NFR-2.** Lighthouse a11y score ≥ 95 on the auth + invoice routes.
- **NFR-3.** No FOUC; design tokens applied before first paint.

## 6. Technical design

### 6.1 Env (`src/env.ts`)

```ts
import { z } from "zod";

const Env = z.object({
  VITE_API_BASE_URL: z.string().url(),
  VITE_APP_NAME: z.string().min(1).default("Facturador"),
  MODE: z.enum(["development", "test", "production"]).default("development"),
});

export type WebEnv = z.infer<typeof Env>;
export const env: WebEnv = Env.parse({ ...import.meta.env });
```

### 6.2 HTTP client (`src/api/client.ts`)

```ts
import { ProblemDetailSchema } from "@facturador/contracts/error";
import { env } from "../env.js";
import { getCsrfTokenFromCookie } from "./csrf.js";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const apiFetch = async <T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> => {
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (STATE_CHANGING.has(method)) {
    const csrf = getCsrfTokenFromCookie();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const res = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    body,
    credentials: "include",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const parsed = ProblemDetailSchema.safeParse(data);
  if (!parsed.success) throw new ApiError("internal.unexpected", res.status, "Unexpected error");
  if (res.status === 401) await onUnauthorized();
  throw new ApiError(parsed.data.code, parsed.data.status, parsed.data.title, parsed.data.errors);
};

let onUnauthorized: () => Promise<void> = async () => {};
export const setOnUnauthorized = (fn: () => Promise<void>) => (onUnauthorized = fn);
```

### 6.3 CSRF helper (`src/api/csrf.ts`)

```ts
export const getCsrfTokenFromCookie = (): string | null => {
  const m = document.cookie.match(/(?:^|; )__Host-facturador\.csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
};
```

(Cookie name comes from the API per [SPEC-0010](./0010-authentication-and-sessions.md). Hard-code to match the prod name.)

### 6.4 App shell / providers (`src/main.tsx`)

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/auth-context";
import { ToastProvider } from "./ui/toast";
import { ErrorBoundary } from "./error-boundary";
import "./styles/globals.css";
import { Routes as AppRoutes } from "./routes/_routes";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
```

### 6.5 Tailwind + tokens

`tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
export default config;
```

`styles/tokens.css` carries CSS variables for spacing/radius/shadow that components consume.

### 6.6 UI primitives (signatures)

All UI primitives have these properties:

- Accept all native HTML props via `React.ComponentPropsWithoutRef<...>`.
- Forward refs.
- Forbid `style` prop on primitives — variants only.
- No external dep beyond `class-variance-authority` (or hand-rolled `cn(...)` helper).

Example:

```tsx
// ui/button.tsx
import { forwardRef } from "react";
import { cn } from "../utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export const Button = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { variant?: Variant; size?: Size; loading?: boolean }
>(({ className, variant = "primary", size = "md", loading, disabled, children, ...rest }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(base(variant, size), className)}
    {...rest}
  >
    {loading ? <Spinner /> : children}
  </button>
));
```

### 6.7 Layout

`AppShell` renders a top bar (logo + tenant switcher + user menu), a left sidebar (Invoices, Customers, Certificates, Configuration), and a content `<main>` with a max-width container.

### 6.8 Error handling pattern in routes

```tsx
const { data, error, isLoading } = useQuery({ queryKey: ["invoices"], queryFn: listInvoices });
if (isLoading) return <Skeleton />;
if (error instanceof ApiError) return <ErrorState code={error.code} message={error.message} />;
```

A central mapping (`src/api/error-messages.ts`) translates `ApiError.code` → Spanish user-friendly message.

## 7. Implementation guide

### 7.1 Steps

1. Scaffold Vite project: `pnpm dlx create-vite apps/web --template react-ts` (then adapt to the layout in §6).
2. Add deps from §7.2.
3. Implement files in §6.
4. Add Vitest + Testing Library configs (per [SPEC-0007](./0007-testing-strategy.md)).
5. Smoke test: `pnpm --filter @facturador/web dev` → open `localhost:5173` → see "Iniciar sesión" page (stub from [SPEC-0041](./0041-web-auth-flows.md)).

### 7.2 Dependencies

| Package                            | Version       | Purpose                    |
| ---------------------------------- | ------------- | -------------------------- |
| `react`, `react-dom`               | `^18.3.1`     | Framework.                 |
| `react-router-dom`                 | `^6.26.0`     | Routing.                   |
| `@tanstack/react-query`            | `^5.51.0`     | Data fetching.             |
| `tailwindcss`                      | `^3.4.0`      | Styling.                   |
| `@tailwindcss/forms`               | `^0.5.7`      | Form resets.               |
| `postcss`, `autoprefixer`          | latest stable | PostCSS pipeline.          |
| `class-variance-authority`         | `^0.7.0`      | (or skip if using `cn()`). |
| `react-hook-form`                  | `^7.52.0`     | Forms.                     |
| `@hookform/resolvers`              | `^3.9.0`      | Zod resolver.              |
| `zod`                              | `^3.23.0`     | (already).                 |
| `@types/react`, `@types/react-dom` | `^18`         | Types.                     |
| `vite`                             | `^5.4.0`      | Bundler.                   |
| `@vitejs/plugin-react`             | `^4.3.0`      | Plugin.                    |

### 7.3 Conventions

- One component per file; default exports allowed in `routes/*` only (router lazy-loading wants defaults).
- All user-facing strings in `i18n/es.ts`. Components import strings, not hard-code them.
- All forms use `react-hook-form` + `zodResolver(<Schema>)` where the schema comes from `@facturador/contracts`.
- No inline `style={{...}}` outside of dynamic computed values (e.g. progress bars).

## 8. Acceptance criteria

- **AC-1.** `pnpm --filter @facturador/web dev` opens and shows a working router with at least login + a placeholder dashboard.
- **AC-2.** `pnpm --filter @facturador/web build` produces a `dist/` ≤ 300 KB gzipped total assets for the initial route.
- **AC-3.** `apiFetch("/api/v1/auth/me")` includes the session cookie and a CSRF header on POST.
- **AC-4.** A 401 response triggers `onUnauthorized` → user is redirected to `/login`.
- **AC-5.** A non-JSON 500 response throws `ApiError("internal.unexpected", 500)`.
- **AC-6.** Lighthouse a11y ≥ 95 on `/login` (manual run).
- **AC-7.** Throwing in a component renders the ErrorBoundary fallback in dev with stack visible.

## 9. Test plan

- Component tests for Button, Input, Dialog (open/close, focus trap).
- Integration test for `apiFetch` against an MSW handler.
- Visual smoke check: `pnpm --filter @facturador/web preview` after build.

## 10. Security considerations

- `credentials: "include"` requires CORS in API (`CORS_ALLOWED_ORIGINS` from [SPEC-0003](./0003-docker-and-local-dev.md)).
- CSP set on the production Nginx (see [SPEC-0003](./0003-docker-and-local-dev.md) §6.5).
- No `dangerouslySetInnerHTML` allowed (ESLint rule).
- `process.env`/`import.meta.env` only via `src/env.ts`.

## 11. Observability

- Errors surfaced via Toast and logged to console at warn level in dev.
- Future: client-side error reporting (Sentry) — separate spec.

## 12. Risks and mitigations

| Risk                                            | Mitigation                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Tailwind purge eats classes used dynamically    | Use full class names in source (no string concatenation for class names). |
| TanStack Query stale data leaks between tenants | Query keys must include `tenantId`; the tenant context provides it.       |

## 13. Open questions

- Pre-fetch with router loaders? Yes for invoice list/detail (in [SPEC-0043](./0043-web-invoice-list-and-detail.md)). Not needed for this bootstrap.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
