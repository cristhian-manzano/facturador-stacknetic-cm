---
id: PROMPT-0040
spec: SPEC-0040
plan: PLAN-0040
tasks: TASKS-0040
title: Execute TASKS-0040 — Web app bootstrap
---

# PROMPT-0040 — Execute web app bootstrap

You are an autonomous senior frontend engineer experienced in React + Vite + TanStack Query. Execute **TASKS-0040**: stand up the Vite + React 18 SPA shell, the `apiFetch` helper with ProblemDetail handling, the AuthContext + RequireAuth guard, and the basic layout.

---

## 1. Mandatory reading

1. `ai/specs/0040-web-app-bootstrap.md` — authoritative.
2. `ai/plans/0040-web-app-bootstrap-plan.md`.
3. `ai/tasks/0040-web-app-bootstrap-tasks.md`.
4. `ai/specs/0005-shared-contracts.md` — schemas consumed by the SPA.
5. `ai/specs/0006-error-model-and-logging.md` — ProblemDetail shape.
6. `ai/specs/0007-testing-strategy.md` — Vitest jsdom + Testing Library + MSW.
7. `ai/specs/0010-authentication-and-sessions.md` — cookie names, `/me` shape.
8. `ai/specs/0011-tenants-memberships-rbac.md` — `permissions` array in `/me`.
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the bootstrap, `apiFetch`, AuthContext, RequireAuth, layout shell, and i18n.
- ❌ Do NOT implement login form, tenant switcher, invoice/customer screens. Those are SPECs 0041–0043.
- ❌ Do NOT use localStorage for credentials.
- ❌ Do NOT bypass the schema-validated response in `apiFetch`.

## 3. Stack constraints

- Vite 5; React 18; React Router 6 data router; TanStack Query 5; React Hook Form + zodResolver.
- Tailwind 3.
- Vitest + jsdom + Testing Library + MSW for tests.
- TypeScript strict; ESM only.

## 4. Code quality bar

- `apiFetch` is the only allowed network primitive; tests grep the source to assert no direct `fetch(` calls outside `lib/api.ts`.
- `AuthContext` exposes a stable shape; consumers never read raw cookies directly.
- Permissions gate navigation links; the server remains the authority.
- No emoji in code or UI strings unless requested by the user.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/web test` exits 0; coverage ≥ 70% statements.
- `pnpm --filter @facturador/web build` exits 0; `dist/index.html` present.
- Manual smoke: `dev` server serves the SPA; visiting `/` while unauthenticated redirects to `/login`.
- MSW-backed tests cover apiFetch happy/401/403/400-ProblemDetail/CSRF-header.

## 6. Security considerations

- No secrets or tokens in localStorage.
- The CSRF cookie value is read for the header only on mutating methods; never sent back as a body.
- 401 / 403 events are global; `AuthContext` resets on 401, redirecting via Router.
- `apiFetch` parses ProblemDetail safely and never `eval`s body content.
- No third-party scripts loaded; no analytics; no fonts from CDN (use system fonts for v1).
- `Content-Security-Policy` headers are configured server-side later; for v1 web, do NOT inline scripts; rely on Vite output.

## 7. Deliverables

When TASKS-0040 is green, write `ai/reviews/0040-web-app-bootstrap-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test coverage report.
   - Build output (size summary).
   - Manual smoke screenshots or console-level confirmation of the redirect.
4. **apiFetch contract** — code excerpt + table of inputs/outputs.
5. **Auth lifecycle diagram** — short.
6. **Deviations from spec/plan**.
7. **Risks observed** — bundle size, CSP gaps, cookie attribute pitfalls in dev.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — i18n library when adding English; offline detection; service worker.
10. **Sign-off checklist** — SPEC-0040 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0040 boxes ticked.
- Tests + build green.
- Review file complete.

Begin.
