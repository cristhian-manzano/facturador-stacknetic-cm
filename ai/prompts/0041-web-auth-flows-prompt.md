---
id: PROMPT-0041
spec: SPEC-0041
plan: PLAN-0041
tasks: TASKS-0041
title: Execute TASKS-0041 — Web auth flows
---

# PROMPT-0041 — Execute web auth flows

You are an autonomous senior frontend engineer focused on auth UX and accessibility. Execute **TASKS-0041**: implement the login page, tenant switcher, RequirePermission guard, logout, and open-redirect-safe `next` sanitiser.

---

## 1. Mandatory reading

1. `ai/specs/0041-web-auth-flows.md` — authoritative.
2. `ai/plans/0041-web-auth-flows-plan.md`.
3. `ai/tasks/0041-web-auth-flows-tasks.md`.
4. `ai/specs/0040-web-app-bootstrap.md` — bootstrap (apiFetch, AuthContext, RequireAuth).
5. `ai/specs/0010-authentication-and-sessions.md`, `ai/specs/0011-tenants-memberships-rbac.md` — server contracts.
6. `ai/context/security.md` — no email-existence hints.
7. `ai/specs/0005-shared-contracts.md` — schemas.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only the login page, tenant select/switcher, RequirePermission, logout, next-sanitiser, 403 page.
- ❌ Do NOT implement password reset / 2FA / OAuth.
- ❌ Do NOT show email-existence hints under any condition.
- ❌ Do NOT skip the `next` sanitiser; open redirects are a real attack surface.
- ❌ Do NOT bypass `apiFetch`; never call `fetch` directly.

## 3. Stack constraints

- React 18 + React Router 6 data router; React Hook Form + zodResolver; TanStack Query 5; Tailwind 3.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Error mapping from `ApiError.problem.errors[]` to RHF `setError` is centralised in a helper (`mapProblemErrorsToForm(setError, errors)`).
- All copy goes through `i18n/es.ts`.
- Component tests assert ARIA roles (`role="alert"` for banners; labels on form fields).
- Spinner inside the submit button keeps focus management correct.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/web test` exits 0; coverage ≥ 70%.
- MSW-backed login tests pass for 200 / 400 / 401 / 429.
- Tenant switcher test demonstrates `qc.clear()` and a CSRF cookie change.
- `RequirePermission` test redirects to `/forbidden` correctly.
- `sanitise-next` tests cover all 5 listed inputs.
- Manual smoke: dev compose; happy login + bad login + tenant switch + logout work.

## 6. Security considerations

- The login error banner copy is exactly "Credenciales inválidas" (or your project's localized equivalent). No variation that leaks user state.
- The `next` value passes through `sanitise-next`; reject anything that isn't a same-origin path.
- The tenant switcher's POST uses `apiFetch` with the CSRF header attached.
- Logout clears AuthContext before navigating; UI cannot "see" the previous state.
- 403 page link to `/` exists; do not auto-redirect to `/login` from 403 — that erases context. Only 401 redirects to `/login`.

## 7. Deliverables

When TASKS-0041 is green, write `ai/reviews/0041-web-auth-flows-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test outputs.
   - Manual smoke screenshots or annotated steps.
4. **Auth UX flow diagram**.
5. **Error mapping** — how ApiError.problem.errors maps to RHF setError.
6. **Deviations from spec/plan**.
7. **Risks observed** — multi-tab session pitfalls; tenant switch race.
8. **Security review** — confirm §6 verbatim.
9. **Suggested follow-ups** — password reset; 2FA; "remember this device".
10. **Sign-off checklist** — SPEC-0041 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0041 boxes ticked.
- Tests green; manual smoke green.
- Review file complete.

Begin.
