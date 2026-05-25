---
id: PROMPT-0011
spec: SPEC-0011
plan: PLAN-0011
tasks: TASKS-0011
title: Execute TASKS-0011 — Tenants, memberships & RBAC
---

# PROMPT-0011 — Execute tenants, memberships & RBAC

You are an autonomous senior backend engineer with multi-tenant security expertise. Execute **TASKS-0011**: build tenant CRUD, session tenant switching, the RBAC matrix, and the `requireTenant` / `requirePermission` middleware chain.

---

## 1. Mandatory reading

1. `ai/specs/0011-tenants-memberships-rbac.md` — authoritative.
2. `ai/plans/0011-tenants-memberships-rbac-plan.md`.
3. `ai/tasks/0011-tenants-memberships-rbac-tasks.md`.
4. `ai/specs/0010-authentication-and-sessions.md` — session + CSRF.
5. `ai/specs/0004-database-and-prisma.md` — `Company`, `Membership`, `Role`.
6. `ai/specs/0005-shared-contracts.md` — tenant + membership schemas.
7. `ai/specs/0006-error-model-and-logging.md` — ProblemDetail, audit, validateBody.
8. `ai/context/security.md` — multi-tenant invariants ("companyId must never come from the client").
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Implement only TASKS-0011.
- ❌ Do not add email-based invitations, custom roles, or RLS. Those are later specs.
- ❌ Do not introduce wildcard permissions or `super-admin`-style escapes outside the matrix.
- ❌ Do not accept `companyId` from a request body for any business endpoint.
- ❌ Do not skip the "last OWNER" guard.

## 3. Stack constraints

- Express 5; Prisma 5; Zod; argon2 (unchanged from SPEC-0010).
- All RBAC checks via the pure `can(role, action)` function in `@facturador/utils/rbac`.
- All schemas via `@facturador/contracts`.

## 4. Code quality bar

- Permission matrix is a single source of truth in code; tests iterate over it exhaustively.
- Endpoints have at most one Express handler; logic delegated to a `service` (function) for testability.
- Last-OWNER guard runs in the same transaction as the membership update (Prisma `$transaction`).
- Tenant switch is atomic: CSRF rotation + companyId update happen together (transaction).
- `req.companyId`, `req.role`, `req.membership` typed via Express request augmentation (no `(req as any)`).

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test apps/api/test/tenants.test.ts` exits 0.
- Exhaustive RBAC matrix test in `@facturador/utils` covers every action × every role pairing.
- CSRF rotation observed in the integration test: pre-switch CSRF cookie value ≠ post-switch CSRF cookie value, and mutating requests with the stale value fail 403.
- Cross-tenant probe: a `?companyId=other` query parameter is ignored; `req.companyId` always comes from the session.
- Last-OWNER demotion / deletion returns 422 with `code: "last_owner"`.

## 6. Security considerations

- `companyId` is derived from `req.session.companyId` **only**. Lint or a code review checklist enforces this for future routes.
- Tenants of which the user is not a member must not be acknowledged in responses (no 404 "tenant exists" leak — return 403 with generic body).
- Session id never appears in logs or responses (already redacted via SPEC-0006).
- Audit rows must not include the CSRF token. They may include companyId and actorUserId.
- The `permissions` array in `MeResponseSchema` reflects the **server-side** matrix; the web uses it for UI hints only, not for enforcement.
- A user who lost membership mid-session must be rejected on the next request (load membership freshly on every `requireTenant` hit).

## 7. Deliverables

When TASKS-0011 is green, write `ai/reviews/0011-tenants-memberships-rbac-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test output for RBAC matrix tests.
   - Test output for `tenants.test.ts`.
   - Snippet showing CSRF cookie rotation (pre vs post).
   - Snippet showing `?companyId=other` ignored.
4. **Permission matrix** — paste the resolved matrix.
5. **Deviations from spec/plan**.
6. **Risks observed** — e.g., performance of loading membership on every request; later spec should consider a per-request cache.
7. **Security review** — list each invariant from §6 and confirm.
8. **Suggested follow-ups** — RLS, custom roles, email invitations.
9. **Sign-off checklist** — SPEC-0011 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; full audit in the review.

## 9. Exit condition

- All TASKS-0011 boxes ticked.
- All tests green.
- Review file complete.

Begin.
