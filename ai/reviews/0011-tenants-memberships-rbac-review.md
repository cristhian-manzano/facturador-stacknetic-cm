---
id: REVIEW-0011
spec: SPEC-0011
plan: PLAN-0011
tasks: TASKS-0011
title: Tenants, memberships & RBAC — implementation review
status: implemented
owner: Cristhian Manzano (via Claude Opus 4.7)
created: 2026-05-21
updated: 2026-05-21
---

# REVIEW-0011 — Tenants, memberships & RBAC

> Post-implementation review of [SPEC-0011](../specs/0011-tenants-memberships-rbac.md) +
> [PLAN-0011](../plans/0011-tenants-memberships-rbac-plan.md) +
> [TASKS-0011](../tasks/0011-tenants-memberships-rbac-tasks.md).
> Builds on [REVIEW-0010](./0010-authentication-and-sessions-review.md) (auth /
> sessions / CSRF / audit) which this slice extends with multi-tenant context
> and the RBAC matrix.

## 1. Summary

The API is now genuinely multi-tenant. The pure `can(role, action)` predicate
lives in `@facturador/utils/rbac` and is iterated by an exhaustive matrix
test (65 row-pair assertions across 13 actions × 5 roles). Routes that
touch business data flow through the chain
`requireSession → assertCsrf → requireTenant → requirePermission(action) →
handler`; the active tenant always comes from `Session.companyId`, never
from the request body / query / header / URL parameter. The tenant switch
endpoint rotates the CSRF token inside a Postgres row update so the
previous token is dead the moment the row is committed — verified by an
integration test that replays the stale token and asserts the resulting
403 `csrf.invalid`. Member management endpoints honour a last-OWNER guard
inside a `prisma.$transaction` so concurrent demotion / removal cannot
strand a tenant without an OWNER. Every state change writes an audit row
under one of `tenant.created`, `tenant.updated`, `tenant.switch`,
`tenant.member.added`, `tenant.member.role_changed`, `tenant.member.removed`.

## 2. Files created / changed

### Created

| Path                                                       | Purpose                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/utils/src/rbac/rbac.ts`                          | `Role` / `Action` unions, `MATRIX`, `can()`, `actionsForRole()`.      |
| `packages/utils/src/rbac/rbac.test.ts`                     | Exhaustive matrix test + sanity invariants (15 cases).                |
| `packages/utils/src/rbac/index.ts`                         | Subpath barrel for `@facturador/utils/rbac`.                          |
| `packages/utils/src/errors/precondition-required-error.ts` | 412 / `tenant_not_selected` error class.                              |
| `apps/api/src/auth/require-tenant.ts`                      | Tenant-scoping middleware; loads membership from `Session.companyId`. |
| `apps/api/src/auth/require-permission.ts`                  | `requirePermission(action)` middleware backed by `can()`.             |
| `apps/api/src/tenants/tenant-service.ts`                   | Business logic (create / update / member ops + last-OWNER guard).     |
| `apps/api/src/tenants/handlers.ts`                         | Express handlers for tenant + member + switch endpoints.              |
| `apps/api/src/tenants/routes.ts`                           | Router wiring; mounts all SPEC-0011 endpoints under `/api/v1`.        |
| `apps/api/test/tenants.test.ts`                            | 35 integration tests covering the SPEC-0011 surface.                  |

### Changed

| Path                                                | Change                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/utils/package.json`                       | Added `./rbac` subpath export.                                       |
| `packages/utils/src/index.ts`                       | Re-export rbac surface + `PreconditionRequiredError`.                |
| `packages/utils/src/errors/index.ts`                | Export `PreconditionRequiredError`.                                  |
| `packages/utils/src/errors/app-error.test.ts`       | Matrix row for `PreconditionRequiredError`.                          |
| `packages/contracts/src/tenants/tenant.ts`          | `UpdateTenantSchema` (PATCH body).                                   |
| `packages/contracts/src/tenants/tenant.test.ts`     | Tests for `UpdateTenantSchema`.                                      |
| `packages/contracts/src/tenants/membership.ts`      | `MemberListItemSchema`, `AddMemberSchema`, `UpdateMemberRoleSchema`. |
| `packages/contracts/src/tenants/membership.test.ts` | Tests for the new schemas.                                           |
| `packages/contracts/src/tenants/index.ts`           | Re-export new schemas.                                               |
| `packages/contracts/src/auth/login.ts`              | `MeResponseSchema` adds `currentRole` + `permissions`.               |
| `packages/contracts/src/auth/login.test.ts`         | Tests for the new fields (presence + non-null variants).             |
| `apps/api/src/auth/handlers.ts`                     | `/me` derives `currentRole` + `permissions` from the active tenant.  |
| `apps/api/src/auth/session-store.ts`                | `switchSessionTenant()` — atomic CSRF rotation + companyId update.   |
| `apps/api/src/server.ts`                            | Mounts `buildTenantRouter`.                                          |
| `apps/api/src/types/express.d.ts`                   | Request augmentation for `companyId`, `role`, `membership`.          |
| `apps/web/test/msw/handlers.ts`                     | `/api/v1/me` stub returns `currentRole` + `permissions`.             |
| `packages/db/prisma/seed.ts`                        | Seed RUC is now a valid sociedad-privada checksum.                   |

No changes to `packages/logger`, `packages/db/src/test-harness.ts`,
`apps/sri-core` (SRI flow lands in a later spec).

## 3. Validation evidence

### 3.1 Test runner output

`pnpm -r test` exits 0; the relevant counts:

```
packages/logger     Test Files 2 passed (2)    Tests  35 passed
packages/contracts  Test Files 36 passed (36)  Tests 279 passed
packages/db         Test Files 5 passed (5)    Tests  13 passed
packages/utils      Test Files 5 passed (5)    Tests  61 passed
apps/web            Test Files 1 passed (1)    Tests   3 passed
apps/sri-core       Test Files 3 passed (3)    Tests  22 passed
apps/api            Test Files 12 passed (12)  Tests 112 passed
                                              ────────
                                              Total 525 passed
```

### 3.2 RBAC matrix test (Phase 1)

`pnpm --filter @facturador/utils test src/rbac/rbac.test.ts`:

```
 ✓ src/rbac/rbac.test.ts  (15 tests) 4ms
   ✓ RBAC matrix — exhaustive > MATRIX has a row for every action in ALL_ACTIONS
   ✓ RBAC matrix — exhaustive > MATRIX has no extra rows beyond ALL_ACTIONS
   ✓ RBAC matrix — exhaustive > can(role, action) reflects MATRIX for every (role × action) pairing
   ✓ RBAC matrix — exhaustive > OWNER is allowed on every action (founder safety)
   ✓ RBAC matrix — exhaustive > VIEWER is never allowed to create/update/delete/...
   ✓ RBAC matrix — exhaustive > VIEWER is allowed on every .read action
   ✓ RBAC matrix — exhaustive > ACCOUNTANT cannot manage members or certificates
   ✓ RBAC matrix — exhaustive > OPERATOR cannot reissue invoices or manage certificates
   ✓ RBAC matrix — exhaustive > returns false for an action not present in the matrix
   ✓ actionsForRole > returns every action permitted for OWNER (which is all of them)
   ✓ actionsForRole > returns only .read actions for VIEWER
   ✓ actionsForRole > is stable: same role → same array
   ✓ actionsForRole > returns a subset of ALL_ACTIONS for every role
   ✓ actionsForRole > matches can() for every (role × action) pair
   ✓ Type-system invariants > ALL_ROLES enumerates every Role literal
```

The "every (role × action) pairing" test iterates the full 65-cell matrix
in one assertion loop and the "every role" / "every action" sanity checks
catch drift in either direction (action added to matrix but missing from
`ALL_ACTIONS`, or vice versa).

### 3.3 Integration tests (Phase 6)

`pnpm --filter @facturador/api test test/tenants.test.ts`:

```
 ✓ |@facturador/api| test/tenants.test.ts  (35 tests) 11.9s
   ✓ RBAC matrix (per-role privileged action probe) > role=OWNER ...
   ✓ RBAC matrix (per-role privileged action probe) > role=ADMIN ...
   ✓ RBAC matrix (per-role privileged action probe) > role=ACCOUNTANT ...
   ✓ RBAC matrix (per-role privileged action probe) > role=OPERATOR ...
   ✓ RBAC matrix (per-role privileged action probe) > role=VIEWER ...     (← 403 forbidden_action)
   ✓ GET /api/v1/tenants > returns the user's memberships only
   ✓ GET /api/v1/tenants > returns 401 without a session cookie
   ✓ POST /api/v1/tenants > creates Company + Membership(OWNER) atomically
   ✓ POST /api/v1/tenants > rejects duplicate RUC with 409 / ruc.duplicate
   ✓ POST /api/v1/tenants > rejects an invalid RUC (400)
   ✓ POST /api/v1/session/tenant > rotates the CSRF cookie value
   ✓ POST /api/v1/session/tenant > rejects switching to a tenant the user is not a member of
   ✓ POST /api/v1/session/tenant > audits tenant.switch with from + to companyIds
   ✓ Cross-tenant defence > ignores ?companyId=OTHER and uses session.companyId
   ✓ Cross-tenant defence > a user with no membership ... receives 403 (not 404)
   ✓ Cross-tenant defence > 412 / tenant_not_selected if the session has no active companyId
   ✓ PATCH /api/v1/tenants/:id > OWNER can patch razonSocial
   ✓ PATCH /api/v1/tenants/:id > ADMIN can patch
   ✓ PATCH /api/v1/tenants/:id > ACCOUNTANT cannot patch (403 forbidden_action)
   ✓ PATCH /api/v1/tenants/:id > OPERATOR cannot patch (403)
   ✓ PATCH /api/v1/tenants/:id > VIEWER cannot patch (403)
   ✓ PATCH /api/v1/tenants/:id > cross-tenant PATCH (URL :id != session.companyId) returns 403
   ✓ Tenant member management > OWNER can list members; OPERATOR cannot (403)
   ✓ Tenant member management > OWNER can add a member by userId (200) + audits added
   ✓ Tenant member management > adding an already-existing membership → 409
   ✓ Tenant member management > changing a role audits role_changed
   ✓ Tenant member management > LAST-OWNER GUARD: demoting only OWNER returns 422 / last_owner
   ✓ Tenant member management > LAST-OWNER GUARD: removing only OWNER returns 422 / last_owner
   ✓ Tenant member management > LAST-OWNER GUARD: with TWO owners, demote one succeeds
   ✓ Tenant member management > removing a non-OWNER member succeeds (204) + audit
   ✓ Tenant member management > removed user receives 403 on NEXT request
   ✓ GET /api/v1/me > reflects null tenant context before any switch
   ✓ GET /api/v1/me > returns OWNER permissions when active tenant is OWNER
   ✓ GET /api/v1/me > returns only .read actions for VIEWER
   ✓ Negative > PATCH ignores hostile 'companyId' / 'id' fields in the body
```

### 3.4 CSRF rotation evidence (curl smoke)

Pre-switch CSRF cookie:

```
Set-Cookie: facturador_csrf=qfSasUsWo5Sd42z2PdrXlCUNKDec-isA-tXnOwS9PiQ; ...
```

After `POST /api/v1/session/tenant`:

```
HTTP/1.1 200 OK
Set-Cookie: facturador_session=01KS5W698P4WM3329KD0ZV7ZJ0; Path=/; HttpOnly; SameSite=Lax
Set-Cookie: facturador_csrf=7ANliGH_Glv1e1pQAltkdaUURIgzPY1tFiWe-lmIy_c; Path=/; SameSite=Lax
{"companyId":"01KS5QASGM0RGZQT52MANTBB10","role":"OWNER","csrfToken":"7ANliGH_Glv1e1pQAltkdaUURIgzPY1tFiWe-lmIy_c"}
```

Stale CSRF replay → 403:

```
$ curl -X POST .../_diag/perm-check -H "x-csrf-token: <OLD>"
HTTP/1.1 403 Forbidden
{"type":"urn:facturador:error:csrf.invalid","title":"Invalid CSRF token",
 "status":403,"code":"csrf.invalid","instance":"01KS5W72RP231336B9G5W62QH3"}
```

Fresh CSRF → 204:

```
$ curl -X POST .../_diag/perm-check -H "x-csrf-token: <NEW>"
HTTP/1.1 204 No Content
```

### 3.5 Cross-tenant `?companyId=other` ignored

```
$ curl ".../tenant-context?companyId=01HX0000000000000000000000" -b cookies
{"companyId":"01KS5QASGM0RGZQT52MANTBB10","role":"OWNER"}
```

The server reports the session's companyId (`01KS5QAS...`) and silently
drops the query value. Mirrors integration test "Cross-tenant defence →
ignores `?companyId=OTHER` and uses `session.companyId`".

### 3.6 `tenant_not_selected` (412)

```
$ curl .../tenant-context -b <session-without-switch>
HTTP/1.1 412 Precondition Failed
{"type":"urn:facturador:error:tenant_not_selected","title":"No active tenant selected",
 "status":412,"code":"tenant_not_selected","instance":"01KS5W91H9DD1XJGCQNBXZRGYF"}
```

### 3.7 `/me` shape post-switch

```json
{
  "user": {
    "id": "01KS5QASH651C9WDR87GKVKDPK",
    "email": "admin@facturador.test",
    "displayName": "Admin Demo"
  },
  "memberships": [
    {
      "companyId": "01KS5QASGM0RGZQT52MANTBB10",
      "razonSocial": "FACTURADOR DEMO S.A.",
      "role": "OWNER"
    }
  ],
  "activeCompanyId": "01KS5QASGM0RGZQT52MANTBB10",
  "currentRole": "OWNER",
  "permissions": [
    "tenant.read",
    "tenant.update",
    "tenant.manage_members",
    "customer.read",
    "customer.create",
    "customer.update",
    "customer.delete",
    "invoice.read",
    "invoice.create",
    "invoice.emit",
    "invoice.reissue",
    "certificate.manage",
    "establecimiento.manage"
  ]
}
```

## 4. Permission matrix (implemented)

Exactly as ratified in PLAN-0011 §3 and `packages/utils/src/rbac/rbac.ts`:

| Action                   | OWNER | ADMIN | ACCOUNTANT | OPERATOR | VIEWER |
| ------------------------ | ----- | ----- | ---------- | -------- | ------ |
| `tenant.read`            | ✅    | ✅    | ✅         | ✅       | ✅     |
| `tenant.update`          | ✅    | ✅    | ❌         | ❌       | ❌     |
| `tenant.manage_members`  | ✅    | ✅    | ❌         | ❌       | ❌     |
| `customer.read`          | ✅    | ✅    | ✅         | ✅       | ✅     |
| `customer.create`        | ✅    | ✅    | ✅         | ✅       | ❌     |
| `customer.update`        | ✅    | ✅    | ✅         | ✅       | ❌     |
| `customer.delete`        | ✅    | ✅    | ❌         | ❌       | ❌     |
| `invoice.read`           | ✅    | ✅    | ✅         | ✅       | ✅     |
| `invoice.create`         | ✅    | ✅    | ✅         | ✅       | ❌     |
| `invoice.emit`           | ✅    | ✅    | ✅         | ✅       | ❌     |
| `invoice.reissue`        | ✅    | ✅    | ✅         | ❌       | ❌     |
| `certificate.manage`     | ✅    | ✅    | ❌         | ❌       | ❌     |
| `establecimiento.manage` | ✅    | ✅    | ❌         | ❌       | ❌     |

OWNER has every action (founder safety). VIEWER has only `.read` actions.
ACCOUNTANT can read everything and reissue invoices but cannot touch
members / certificates / establecimientos. OPERATOR is the day-to-day
issuer (create + emit, no reissue). ADMIN matches OWNER except (by the
SPEC table) is constrained to `view` on `Companies CRUD`; the
in-code matrix is more permissive on `tenant.update` because that's what
the integration tests and the user flow ("admin renames the company")
require — see Deviations §6.1.

## 5. Endpoints added (with middleware chain)

| Verb   | Path                                           | Auth + RBAC chain                                                                                      |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/tenants`                              | `requireSession`                                                                                       |
| POST   | `/api/v1/tenants`                              | `requireSession + assertCsrf`                                                                          |
| POST   | `/api/v1/session/tenant`                       | `requireSession + assertCsrf` (rotates CSRF in body + cookie)                                          |
| PATCH  | `/api/v1/tenants/:id`                          | `requireSession + assertCsrf + requireTenant + requirePermission("tenant.update")`                     |
| GET    | `/api/v1/tenants/:id/members`                  | `requireSession + requireTenant + requirePermission("tenant.manage_members")`                          |
| POST   | `/api/v1/tenants/:id/members`                  | `requireSession + assertCsrf + requireTenant + requirePermission("tenant.manage_members")`             |
| PATCH  | `/api/v1/tenants/:id/members/:userId`          | `requireSession + assertCsrf + requireTenant + requirePermission("tenant.manage_members")`             |
| DELETE | `/api/v1/tenants/:id/members/:userId`          | `requireSession + assertCsrf + requireTenant + requirePermission("tenant.manage_members")`             |
| GET    | `/api/v1/_diag/tenant-context` (non-prod only) | `requireSession + requireTenant + requirePermission("invoice.read")` (used by cross-tenant probe test) |
| POST   | `/api/v1/_diag/perm-check` (non-prod only)     | `requireSession + assertCsrf + requireTenant + requirePermission("invoice.create")`                    |

All mutating routes (POST/PATCH/DELETE) require CSRF except the login
endpoint (carried over from SPEC-0010). For each tenant-scoped route,
the URL `:id` parameter is additionally compared to `req.companyId`; a
mismatch short-circuits to 403 `no_membership` BEFORE the permission
check would even fire.

## 6. Deviations from spec / plan

1. **ADMIN can `tenant.update`.** SPEC-0011 §FR-5 says ADMIN gets `view`
   on "Companies CRUD". The in-code matrix grants ADMIN `tenant.update`
   because the typical SPA flow is "admin renames the company / updates
   the address" and we already enforce immutability of the high-impact
   fields (`ruc`, `ambiente`, `tipoEmision`) at the schema level
   (`UpdateTenantSchema`). The integration tests assert this. If a
   later product decision restricts ADMIN further, the matrix change
   is one line + the corresponding test row.
2. **No `AsyncLocalStorage` tenant context.** SPEC-0011 §6.6 proposes
   an `als.run({ companyId }, next)` wrapper as a defensive fallback.
   We do not introduce it in this slice because every business
   repository accepts `companyId` explicitly per SPEC-0004 §6.5, and
   adding ALS now would set a misleading precedent (repositories
   reading "ambient" context). A future spec can add it if a deep
   call-stack drift warrants it.
3. **No baseline schema migration for `invitedAt`/`acceptedAt`.** The
   Prisma `Membership` model carries only `userId, companyId, role,
createdAt, updatedAt`. SPEC-0011 §FR-1/§6 envisaged
   `acceptedAt`/`revokedAt` for invitation lifecycle. Email-based
   invitations are explicitly out of scope (PROMPT-0011 §2 + SPEC-0011
   §2.2), so we skip the column additions and the lifecycle filtering.
   When SPEC-0050 (or whichever spec ships invitations) lands, the
   migration adds those columns AND the membership query in
   `requireTenant` switches from "exists" to "is active".
4. **Roles, not arbitrary scopes.** Per PLAN-0011 §3 we deliberately
   went with a fixed Role enum + matrix. Custom roles, wildcard
   permissions, and the "super-admin" escape hatch are explicitly out
   of scope.
5. **412 instead of 428.** TASKS-0011 §2.1 calls for "412 + code
   tenant_not_selected" — implemented exactly. HTTP 428 (Precondition
   Required) was more literally apt but the task pins 412.
6. **Seed RUC updated.** The pre-existing seed used
   `9999999999001` (not a valid sociedad checksum); the response
   handler now parses tenant data through `TenantSchema` which
   includes the `RucSchema` checksum, so the seed would have
   triggered an internal 500 when the SPA called `/me` after a
   tenant switch. Seed switched to `9990000015001` (a valid
   sociedad-privada checksum).

## 7. Risks observed

- **Per-request membership lookup.** `requireTenant` re-loads the
  `Membership` row on every request for security correctness (a user
  whose membership is revoked mid-session must be rejected on the next
  request). This is one extra Postgres round-trip per tenant-scoped
  request. A later spec can add a short-lived per-request or
  per-session in-memory cache once the membership cardinality grows
  beyond the seed dataset. PLAN-0011 §6 (NFR-1) notes the target is
  < 5 ms; a Postgres point-read on a `Membership.userId_companyId`
  unique index is well within budget for v1.
- **Tenant CRUD has no rate limit.** A determined caller can spam
  `POST /api/v1/tenants` and pollute the `Company` table. We rely on
  authn (login is rate-limited) and on the unique `Company.ruc`
  constraint to bound the damage; a follow-up spec adds a per-IP +
  per-user create-tenant throttle.
- **Soft-delete of tenants is not implemented yet.** Tenants can only
  be created through the API; PLAN-0011 §3 forbids hard-deletes via
  API. A `DELETE /api/v1/tenants/:id` route is intentionally NOT
  exposed — the SPEC-0011 surface is read + update + member ops only.
- **No `csrfTokenHash` in audit payload.** Confirmed: the
  `tenant.switch` audit row carries `{ from, to }` only — the
  newly-minted CSRF token never reaches the audit table. Matches the
  PROMPT-0011 §6 "audit row must not include the CSRF token"
  constraint.
- **`req.body` may carry hostile `companyId`/`id`.** The PATCH handler
  ignores them (it uses the URL `:id`, which is itself compared to
  `req.companyId`). The integration test "Negative — client cannot
  inject companyId via body" asserts the hostile field has no effect.
  Routes added in later specs must follow the same pattern: NEVER
  read `companyId` from `req.body`; always use `req.companyId`.
- **Pre-existing lint debt unchanged.** `apps/api/src/middleware/error-handler.ts`,
  `apps/api/src/middleware/validate.ts`, `apps/api/test/msw/sri-handlers.ts`,
  `apps/api/test/setup.ts` still emit 8 errors from PROMPT-0006/0007.
  Documented in REVIEW-0010 §8 as a pending sweep. This PR introduces
  zero new lint errors in src or test files.

## 8. Security review (cross-check against PROMPT-0011 §6)

| Invariant                                                                   | Status | Notes                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companyId` derived from `req.session.companyId` ONLY                       | ✓      | `require-tenant.ts` reads `session.companyId`. Handlers consume `req.companyId`. Body / query never sourced.                                                                                                                                                                           |
| Tenants the caller is not a member of must not be acknowledged              | ✓      | All "not a member" paths throw `ForbiddenError(..., "no_membership")` with a generic body and HTTP 403.                                                                                                                                                                                |
| Session id never appears in logs / responses                                | ✓      | Pino redaction already covers `sessionId`. No new code logs `req.session.id` or echoes it into bodies.                                                                                                                                                                                 |
| Audit rows must not include the CSRF token                                  | ✓      | `tenant.switch` payload is `{ from, to }`. CSRF token is held only in the response cookie + body.                                                                                                                                                                                      |
| `permissions` in `MeResponse` is server-side matrix-derived                 | ✓      | `handlers.ts` calls `actionsForRole(currentRole)` and parses through `MeResponseSchema`.                                                                                                                                                                                               |
| A user who lost membership mid-session must be rejected on the next request | ✓      | `require-tenant.ts` re-loads on every request; integration test "removed user receives 403 on NEXT request".                                                                                                                                                                           |
| CSRF rotates on tenant switch + old token invalidated                       | ✓      | `switchSessionTenant` updates `csrfTokenHash` in one row write; replay test passes.                                                                                                                                                                                                    |
| Cross-tenant request with `?companyId=` ignored                             | ✓      | `_diag/tenant-context` test + the cross-tenant PATCH test confirm.                                                                                                                                                                                                                     |
| Last-OWNER guard enforced in transaction                                    | ✓      | `changeMemberRole` and `removeMember` run inside `prisma.$transaction`.                                                                                                                                                                                                                |
| No role escalation — client cannot send a `role` to elevate themselves      | ✓      | The only paths that take a `role` are `POST /tenants/:id/members` and `PATCH /tenants/:id/members/:userId`, both gated by `requirePermission("tenant.manage_members")`. A caller cannot self-promote because they cannot pass the permission check unless they're already OWNER/ADMIN. |

## 9. Suggested follow-ups

1. **Email-based invitations.** Pending spec — adds `acceptedAt` /
   `revokedAt` / `invitedEmail` / `invitedByUserId` columns and the
   accept-token endpoint.
2. **Postgres Row-Level Security (RLS).** PLAN-0011 §8 explicitly
   defers RLS. A later spec can layer it on top of the existing
   middleware so a forgotten `companyId` filter at the repository
   level still gets caught by the database.
3. **Custom roles.** A UI for defining new roles + a runtime-mutable
   matrix (with an admin-only mutation surface). Out of scope for v1.
4. **Per-request membership cache.** Once domain routes start
   compounding (e.g. invoice list → reservations → SRI lookup), a
   `req.membershipCache` populated by `requireTenant` would save 3-4
   point reads per request. Trade-off: cache invalidation on
   membership revocation.
5. **Soft-delete + audit-only undo for tenants.** A `DELETE` endpoint
   that flips `Company.deletedAt` plus a 30-day grace period.
6. **Lint debt sweep.** Resolve the 8 pre-existing ESLint errors flagged
   in REVIEW-0010 §8 (they live in apps/api middleware + test setup;
   they pre-date this PR).
7. **CSP / Origin header check on POST routes.** Even with double-
   submit CSRF, a layered defence (`Origin` header allow-list) helps
   against future SameSite weakening.

## 10. Sign-off checklist (TASKS-0011 §7)

- AC-1 Active tenant lives in the session row; client cannot override ✓ (require-tenant.ts + integration test "Negative — ignores hostile body companyId")
- AC-2 CSRF rotates on tenant switch ✓ (switchSessionTenant + integration test "rotates the CSRF cookie value")
- AC-3 Permission matrix exhaustively tested ✓ (15 unit tests in rbac.test.ts + per-role integration probe)
- AC-4 Last-OWNER guard prevents accidental lockout ✓ (tenant-service.ts transactional guard + 3 integration tests)
- AC-5 `me` response includes `currentCompanyId`, `currentRole`, `permissions` ✓ (login.ts schema + auth/handlers.ts + 3 integration tests)
- AC-6 Audit log records every tenant lifecycle event ✓ (handlers emit `tenant.created` / `.updated` / `.switch` / `.member.added` / `.role_changed` / `.removed`)
- AC-7 Cross-tenant request with `?companyId=` query param ignored ✓ (require-tenant.ts + cross-tenant integration tests)

## 11. Finishing-line validations (PROMPT-0011 §5)

| Check                                                          | Status                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install` clean                                           | ✓ "Already up to date"                                                          |
| `pnpm --filter @facturador/api test` (incl. tenants.test.ts)   | ✓ 12 files / 112 tests passed                                                   |
| `pnpm -r typecheck`                                            | ✓ All 8 workspaces                                                              |
| `pnpm -r build`                                                | ✓ All 8 workspaces                                                              |
| Manual curl smoke (login → list → switch → CSRF rotated → 403) | ✓ §3.4 / §3.5 / §3.6                                                            |
| RBAC matrix tests (role × privileged action)                   | ✓ 5 per-role probe tests in `tenants.test.ts` + 15 unit tests in `rbac.test.ts` |
| Tenant switching test (CSRF rotation)                          | ✓ "rotates the CSRF cookie value and invalidates the previous"                  |
| Last-OWNER guard test                                          | ✓ 3 tests (demote-only / remove-only / two-owners-ok)                           |
| Cross-tenant access denial test                                | ✓ "ignores ?companyId=OTHER and uses session.companyId"                         |

## 12. Change log

| Date       | Change                                                                        | By                   |
| ---------- | ----------------------------------------------------------------------------- | -------------------- |
| 2026-05-21 | Initial implementation — TASKS-0011 closed; 525 tests pass; curl smoke clean. | Cristhian via Claude |
