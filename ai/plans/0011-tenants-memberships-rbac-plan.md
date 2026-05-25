---
id: PLAN-0011
spec: SPEC-0011
title: Tenants, memberships & RBAC — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0011 — Tenants, memberships & RBAC

> Implementation plan for [SPEC-0011](../specs/0011-tenants-memberships-rbac.md). Depends on PLAN-0004/0005/0006/0010.

## 1. Goal

Make the API genuinely multi-tenant:

- `POST /api/v1/session/tenant` switches active tenant; rotates CSRF token; clears any caches.
- `GET /api/v1/tenants` lists tenants the current user belongs to.
- `POST /api/v1/tenants` creates a new tenant (any logged-in user who is allowed to onboard — for v1, any user can create; restrict in later spec).
- `requireTenant` middleware: after `requireSession`, asserts `req.session.companyId` is set; otherwise 412 Precondition Failed (or 409 + `tenant_not_selected`).
- `requirePermission(action)` middleware checks the RBAC matrix.
- Membership management endpoints (invite/revoke/role-change) limited to OWNER/ADMIN.

## 2. Inputs

- [SPEC-0011](../specs/0011-tenants-memberships-rbac.md) — authoritative.
- [SPEC-0010](../specs/0010-authentication-and-sessions.md) — session + CSRF.
- [SPEC-0004](../specs/0004-database-and-prisma.md) — `Membership`, `Role`.
- [SPEC-0005](../specs/0005-shared-contracts.md) — `TenantSchema`, `MembershipSchema`.

## 3. Architecture decisions

| Decision                                                                                                   | Rationale                                                            |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Session.companyId` is the authoritative tenant context.                                                   | Server-side enforced; immune to client tampering.                    |
| Switching tenant rotates **CSRF token** (not session id).                                                  | Mitigates cross-tenant CSRF replay while keeping the session usable. |
| RBAC is a **role matrix**, not arbitrary scopes (for v1).                                                  | Simpler; covers all initial requirements.                            |
| `can(role, action)` is a pure function in `@facturador/utils/rbac`.                                        | Easy to unit-test; shared between server and web (for UI gating).    |
| Actions are kebab-case namespaced strings: `invoice.create`, `invoice.read`, `tenant.manage_members`, etc. | Predictable, lintable.                                               |
| Tenant creation grants the creator `OWNER`.                                                                | The first user owns it; later memberships are invites.               |
| Tenants cannot be hard-deleted via API for v1 (soft-delete only).                                          | Audit trail; protects against accidental data loss.                  |

### Permission matrix (initial)

| Action                   | OWNER | ADMIN | ACCOUNTANT | OPERATOR | VIEWER |
| ------------------------ | ----- | ----- | ---------- | -------- | ------ |
| `tenant.read`            | ✅    | ✅    | ✅         | ✅       | ✅     |
| `tenant.update`          | ✅    | ✅    |            |          |        |
| `tenant.manage_members`  | ✅    | ✅    |            |          |        |
| `customer.read`          | ✅    | ✅    | ✅         | ✅       | ✅     |
| `customer.create`        | ✅    | ✅    | ✅         | ✅       |        |
| `customer.update`        | ✅    | ✅    | ✅         | ✅       |        |
| `customer.delete`        | ✅    | ✅    |            |          |        |
| `invoice.read`           | ✅    | ✅    | ✅         | ✅       | ✅     |
| `invoice.create`         | ✅    | ✅    | ✅         | ✅       |        |
| `invoice.emit`           | ✅    | ✅    | ✅         | ✅       |        |
| `invoice.reissue`        | ✅    | ✅    | ✅         |          |        |
| `certificate.manage`     | ✅    | ✅    |            |          |        |
| `establecimiento.manage` | ✅    | ✅    |            |          |        |

(Authoritative table lives in code; this is the seed.)

## 4. Phases

### Phase 1 — RBAC pure helper

`packages/utils/src/rbac.ts`:

```ts
export type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "OPERATOR" | "VIEWER";
export type Action = "tenant.read" | ... | "invoice.emit" | ...;
const MATRIX: Record<Action, Role[]> = { ... };
export const can = (role: Role, action: Action): boolean => MATRIX[action]?.includes(role) ?? false;
```

### Phase 2 — Middleware

`apps/api/src/auth/require-tenant.ts`: asserts `req.session.companyId` non-null; loads the `Membership` row to attach `req.membership` and `req.role`; rejects with 412 + `code: tenant_not_selected` otherwise.

`apps/api/src/auth/require-permission.ts`: `requirePermission(action) -> middleware`; returns 403 + `code: forbidden_action`.

### Phase 3 — Tenant endpoints

- `GET /api/v1/tenants` (requires session): returns `req.user.memberships` → list of `TenantSchema`-ish (no membership-specific data) + role.
- `POST /api/v1/tenants` (requires session): validates body (`CreateTenantSchema`), creates `Company` + `Membership(role=OWNER)`; audit `tenant.created`; returns the new tenant.
- `POST /api/v1/session/tenant` (requires session, requires body `{ companyId }`): asserts the user has a membership for that company; updates `Session.companyId`; rotates CSRF token (new value via cookie + new hash in row); returns 200 with `{ companyId, role }`.
- `PATCH /api/v1/tenants/:id` (requires `tenant.update`): updates allowed Company fields.
- `GET /api/v1/tenants/:id/members` (requires `tenant.manage_members`): lists memberships.
- `POST /api/v1/tenants/:id/members` (requires `tenant.manage_members`): adds a membership for an existing user (invite-by-email is out of scope; this is direct attach).
- `PATCH /api/v1/tenants/:id/members/:userId` (requires `tenant.manage_members`): change role.
- `DELETE /api/v1/tenants/:id/members/:userId` (requires `tenant.manage_members`): remove membership.

### Phase 4 — Tests

Unit:

- `rbac.test.ts`: parametric over the matrix.

Integration (Supertest):

- Create user A, tenant T1 (A=OWNER), tenant T2 (A=OWNER).
- Switch session to T1; `GET /api/v1/tenants` shows both; current = T1.
- Add user B to T1 as VIEWER.
- B logs in, can `invoice.read` but not `invoice.create` (use a stub guarded route).
- B tries to switch to T2 → 403.
- A demotes B to no membership → next B request to T1 → 403 (no membership).

### Phase 5 — Web gating (server-side response)

The `MeResponseSchema` includes the matrix-derived permissions for the current role; web uses it for UI gating but the server is the source of truth (FE gating is convenience only).

## 5. Risks & mitigations

| Risk                                              | Mitigation                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgetting `requireTenant` on a route leaks data. | Route registration helper that requires `requireTenant` by default unless explicitly opted-out (`requireSessionOnly`). Lint review of every new route added in later specs. |
| CSRF token not rotated on tenant switch.          | Tested explicitly.                                                                                                                                                          |
| User stuck without a tenant after deletion.       | `MeResponseSchema.currentCompanyId` may be null; UI must handle that (covered in SPEC-0041).                                                                                |
| Role list outgrows matrix.                        | Document that adding a role is a code change (no runtime mutation); roll a migration if persisted.                                                                          |

## 6. Validation strategy

- `can()` matrix tested exhaustively (every action × every role).
- Integration tests cover the cross-tenant scenarios listed in Phase 4.
- Switching tenant returns a new `__Host-...csrf` cookie distinct from the pre-switch one.

## 7. Exit criteria

- All SPEC-0011 ACs pass.
- Every existing route (login excluded) wires `requireSession` and either `requireTenant` or `requireSessionOnly`.
- Audit events recorded for tenant.created and membership changes.

## 8. Out of scope

- Email-based invitations (separate spec).
- Custom role definition (UI to add roles) — later.
- Row-Level Security in Postgres — later spec.
