---
id: TASKS-0011
spec: SPEC-0011
plan: PLAN-0011
title: Tenants, memberships & RBAC — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0011 — Tenants, memberships & RBAC

> Checklist for [SPEC-0011](../specs/0011-tenants-memberships-rbac.md) + [PLAN-0011](../plans/0011-tenants-memberships-rbac-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ The client MUST NOT supply `companyId` in any business-domain body. The server always derives it from `req.session.companyId`.
- ❌ A user without a membership for the requested tenant gets 403, never 404 — but the response body MUST NOT reveal that the tenant exists.
- ❌ Never log a session id, CSRF token, or row PII.
- ✅ Every business endpoint added in this slice goes through `requireSession → requireTenant → requirePermission(action)`.
- ✅ RBAC matrix is exhaustively tested (every action × every role).

## 1. RBAC helper

- [ ] **1.1** `packages/utils/src/rbac.ts`:

  - `Role` type matching Prisma enum.
  - `Action` union literal for every action in PLAN-0011 §3.
  - `MATRIX: Record<Action, Role[]>` populated per the table.
  - `can(role: Role, action: Action): boolean`.
    **Validate**: parametric unit test iterates the entire matrix; e.g., `Object.entries(MATRIX).flatMap(([action, roles]) => allRoles.map(r => [r, action, roles.includes(r)]))` and asserts each `can(...)` matches.

- [ ] **1.2** Export via `@facturador/utils/rbac`.
      **Validate**: import works from `apps/api` and `apps/web`.

## 2. Middleware

- [ ] **2.1** `apps/api/src/auth/require-tenant.ts`:

  - Reads `req.session.companyId`; if null, throw a `ProblemDetail`-mapped error (412 + `code: "tenant_not_selected"`). Treat as a custom `AppError` subclass `PreconditionRequiredError`.
  - Loads the active Membership; if missing, 403 `code: "no_membership"`.
  - Attaches `req.membership`, `req.role`, `req.companyId`.
    **Validate**: Supertest:
  - Authenticated user without companyId hits a guarded route → 412.
  - Authenticated user with companyId but no membership → 403.
  - Happy path → passes through.

- [ ] **2.2** `apps/api/src/auth/require-permission.ts`:
  - `requirePermission(action: Action) => Middleware`; uses `can(req.role, action)`; throws `ForbiddenError(code:"forbidden_action")` on false.
    **Validate**: Supertest with a stub route guarded by `requirePermission("invoice.create")`; VIEWER → 403; OPERATOR → passes.

## 3. Endpoints

- [ ] **3.1** `GET /api/v1/tenants` (requires session): returns the user's memberships → array of `{ id, ruc, razonSocial, role }`.
      **Validate**: test creates a user with 2 memberships; endpoint returns 2 entries; body validates `z.array(MembershipSummarySchema).parse(...)`.

- [ ] **3.2** `POST /api/v1/tenants` (requires session, body `CreateTenantSchema`):

  - Creates Company + Membership(role=OWNER) in a single transaction.
  - Emits audit `tenant.created` (companyId, actorUserId).
  - Returns 201 with `TenantSchema`-shaped body.
    **Validate**: integration test asserts both rows exist; audit row exists; idempotency note: the same RUC cannot be created twice (DB unique → 409 ConflictError).

- [ ] **3.3** `POST /api/v1/session/tenant` (requires session, body `{ companyId }`):

  - Validates user has a membership for `companyId` (else 403).
  - Updates `Session.companyId`.
  - **Rotates CSRF**: mints new token, updates `csrfTokenHash`, sets new `__Host-...csrf` cookie.
  - Returns 200 with `{ companyId, role }`.
    **Validate**: Supertest:
  - Tenant switch sets a new Set-Cookie for CSRF distinct from the previous value.
  - Subsequent mutating requests with the OLD csrf header fail with 403.
  - With the NEW csrf header, they pass.

- [ ] **3.4** `PATCH /api/v1/tenants/:id` (requires `tenant.update`): updates allowed Company fields (`razonSocial`, `nombreComercial`, `direccionMatriz`, `contribuyenteEspecial`, `obligadoContabilidad`). Body validated by `UpdateTenantSchema`.
      **Validate**: ADMIN succeeds; VIEWER → 403; OPERATOR → 403; OWNER succeeds.

- [ ] **3.5** `GET /api/v1/tenants/:id/members` (requires `tenant.manage_members`): lists memberships of that tenant.
      **Validate**: OWNER sees all; OPERATOR → 403.

- [ ] **3.6** `POST /api/v1/tenants/:id/members` (requires `tenant.manage_members`): body `{ userId, role }`. Creates a Membership; fails 409 if it already exists.
      **Validate**: integration test creates a second user via direct DB, then adds membership via API; 200.

- [ ] **3.7** `PATCH /api/v1/tenants/:id/members/:userId` (requires `tenant.manage_members`): body `{ role }`. Cannot demote the **last** OWNER (must always be ≥ 1 OWNER per tenant — enforce in transaction).
      **Validate**: demoting the only OWNER returns 422 with `code: "last_owner"`.

- [ ] **3.8** `DELETE /api/v1/tenants/:id/members/:userId` (requires `tenant.manage_members`): removes membership; same "last OWNER" guard.
      **Validate**: deleting the only OWNER returns 422.

## 4. `me` endpoint expansion

- [ ] **4.1** Update `meHandler` (from SPEC-0010) to include:
  - `currentCompanyId: string | null`.
  - `currentRole: Role | null` (derived from membership for that company).
  - `permissions: Action[]` — derived from `MATRIX` for the current role (or `[]` if no current tenant).
    **Validate**: `MeResponseSchema.parse(...)` succeeds; integration test asserts `permissions` array contents match expected role.

## 5. Audit events

- [ ] **5.1** Emit audit rows:
  - `tenant.created`
  - `tenant.updated`
  - `tenant.switch` (with both old and new companyId)
  - `tenant.member.added`
  - `tenant.member.role_changed`
  - `tenant.member.removed`
    **Validate**: integration test asserts each row exists after the corresponding flow.

## 6. Cross-tenant defence-in-depth tests

- [ ] **6.1** User A switches to tenant T1. Construct a request to `GET /api/v1/customers?companyId=T2` (assuming the future customers route exists or stub a route reading `req.companyId`).
      **Validate**: response is scoped to T1 only; `companyId` from query is ignored.

- [ ] **6.2** User B has no membership in T1. Switch attempt to T1: 403.
      **Validate**: confirmed.

## 7. Acceptance criteria

- [ ] AC-1: Active tenant lives in the session row; the client cannot override.
- [ ] AC-2: CSRF rotates on tenant switch.
- [ ] AC-3: Permission matrix exhaustively tested.
- [ ] AC-4: Last-OWNER guard prevents accidental lockout.
- [ ] AC-5: `me` response includes `currentCompanyId`, `currentRole`, `permissions`.
- [ ] AC-6: Audit log records every tenant lifecycle event.
- [ ] AC-7: Cross-tenant request with `?companyId=` query param is ignored; server uses `req.session.companyId`.

## 8. Definition of Done

- All boxes ticked; all integration tests green.
- Review file `ai/reviews/0011-tenants-memberships-rbac-review.md` written.
