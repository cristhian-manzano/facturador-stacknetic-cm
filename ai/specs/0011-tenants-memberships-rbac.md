---
id: SPEC-0011
title: Tenants, memberships & RBAC
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0010]
blocks: [SPEC-0021, SPEC-0030, SPEC-0033, SPEC-0041]
---

# SPEC-0011 — Tenants, memberships & RBAC

## 1. Purpose

Make the platform multi-tenant from day one: every authenticated request resolves a single **active company** (tenant) and every business query enforces ownership. Defines tenant management endpoints, the tenant-switch flow, role definitions, and the request-scoped guard that every domain route consumes.

## 2. Scope

### 2.1 In scope

- `Company` CRUD (admin-only).
- `Membership` invite/accept/revoke (basic, admin-driven).
- `POST /api/v1/session/tenant` — tenant switch.
- `requireTenant({ roles? })` middleware — derives `companyId` from session, enforces role.
- Role definitions and a permission matrix.
- `tenantContext` AsyncLocalStorage that lets downstream services pull `companyId` without threading.

### 2.2 Out of scope

- Email-based invitations (later spec; uses SMTP catcher in dev for now).
- Org hierarchy / sub-tenants.
- API keys per tenant (later).

## 3. Context & references

- [`ai/context/security.md`](../context/security.md) — tenant isolation requirements.
- [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) — session model.
- [SPEC-0010](./0010-authentication-and-sessions.md) — `requireSession`.
- [SPEC-0004](./0004-database-and-prisma.md) — `Company`, `Membership` schemas.

## 4. Functional requirements

- **FR-1.** `GET /api/v1/tenants` — lists companies the current user is a member of (`acceptedAt is not null, revokedAt is null`). Excludes the demo seed in production.
- **FR-2.** `POST /api/v1/tenants` — creates a new company (any authenticated user becomes its `OWNER`). Requires unique `ruc`. Validates RUC checksum.
- **FR-3.** `POST /api/v1/session/tenant` — body `{ companyId }`. Server verifies membership is active; updates `Session.activeCompanyId`; rotates `csrfSecret`; sets a new CSRF cookie. Returns the updated `LoginResponse`-shaped payload.
- **FR-4.** Middleware chain (after `requireSession`):

  ```
  requireSession → csrfGuard → requireTenant({ roles?: Role[] })
  ```

  `requireTenant`:

  - 401 if no session.
  - 403 (`tenant.not_a_member`) if no active membership for `session.activeCompanyId`.
  - 403 (`tenant.forbidden`) if `roles` provided and user's role on this tenant is not in the set.
  - Attaches `{ company, membership }` to `req`.
  - Sets `tenantContext` (AsyncLocalStorage) with `companyId` so deep-call repositories can read it (but **must still accept the explicit param** per [SPEC-0004](./0004-database-and-prisma.md) §6.5; ALS is a defensive fallback, not the primary mechanism).

- **FR-5.** Role permission matrix (RBAC) — exhaustive table:

| Role       | Companies CRUD | Memberships CRUD | Certificates | Emission Points | Customers | Invoices (create / view / cancel-attempt) |
| ---------- | -------------- | ---------------- | ------------ | --------------- | --------- | ----------------------------------------- |
| OWNER      | ✅             | ✅               | ✅           | ✅              | ✅        | ✅ / ✅ / ✅                              |
| ADMIN      | view           | ✅               | ✅           | ✅              | ✅        | ✅ / ✅ / ✅                              |
| ACCOUNTANT | view           | view             | view         | view            | view      | view                                      |
| OPERATOR   | view           | –                | –            | view            | ✅        | ✅ / ✅ / –                               |
| VIEWER     | view           | –                | –            | view            | view      | – / ✅ / –                                |

Codify in `apps/api/src/auth/permissions.ts` as a typed object so downstream specs annotate routes with `requirePermission(...)` instead of hand-coding role checks.

- **FR-6.** Tenant switch audited as `tenant.switched` with `{ from, to }`.

## 5. Non-functional requirements

- **NFR-1.** `requireTenant` adds < 5 ms latency (cached `Membership` row per session).
- **NFR-2.** Permission matrix is the **only** place role logic lives. Routes must not inline role checks.

## 6. Technical design

### 6.1 Layout

```
apps/api/src/
├── tenants/
│   ├── routes.ts
│   ├── handlers/
│   │   ├── list.ts
│   │   ├── create.ts
│   │   └── switch.ts
│   └── services/
│       └── membership-service.ts
├── auth/
│   ├── middleware/
│   │   ├── require-tenant.ts
│   │   └── require-permission.ts
│   └── permissions.ts
└── ...
```

### 6.2 Permissions module

```ts
// apps/api/src/auth/permissions.ts
import type { Role } from "@prisma/client";

export type Action =
  | "company.read"
  | "company.write"
  | "membership.read"
  | "membership.write"
  | "certificate.read"
  | "certificate.write"
  | "emissionPoint.read"
  | "emissionPoint.write"
  | "customer.read"
  | "customer.write"
  | "invoice.read"
  | "invoice.create"
  | "invoice.cancel";

const MATRIX: Record<Role, Action[]> = {
  OWNER: [
    /* all */
  ],
  ADMIN: [
    "company.read",
    "membership.read",
    "membership.write",
    "certificate.read",
    "certificate.write",
    "emissionPoint.read",
    "emissionPoint.write",
    "customer.read",
    "customer.write",
    "invoice.read",
    "invoice.create",
    "invoice.cancel",
  ],
  ACCOUNTANT: [
    "company.read",
    "membership.read",
    "certificate.read",
    "emissionPoint.read",
    "customer.read",
    "invoice.read",
  ],
  OPERATOR: [
    "company.read",
    "emissionPoint.read",
    "customer.read",
    "customer.write",
    "invoice.read",
    "invoice.create",
  ],
  VIEWER: ["company.read", "emissionPoint.read", "customer.read", "invoice.read"],
};

const OWNER_ALL: Action[] = Array.from(new Set(Object.values(MATRIX).flat()));
MATRIX.OWNER = OWNER_ALL;

export const can = (role: Role, action: Action): boolean => MATRIX[role].includes(action);
```

### 6.3 `requireTenant` middleware

```ts
import type { RequestHandler } from "express";
import { prisma } from "../../db/client.js";
import { ForbiddenError } from "../../errors/app-error.js";
import { runWithTenant } from "../tenant-context.js";

export const requireTenant: RequestHandler = async (req, _res, next) => {
  const session = (req as any).session;
  const companyId = session?.activeCompanyId;
  if (!companyId) throw new ForbiddenError("tenant.not_a_member", "No active tenant selected");

  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, companyId, revokedAt: null, acceptedAt: { not: null } },
    include: { company: true },
  });
  if (!membership) throw new ForbiddenError("tenant.not_a_member", "Not a member of active tenant");

  (req as any).tenant = membership.company;
  (req as any).membership = membership;

  runWithTenant({ companyId }, () => next());
};
```

### 6.4 `requirePermission`

```ts
import type { RequestHandler } from "express";
import { ForbiddenError } from "../../errors/app-error.js";
import { can, type Action } from "../permissions.js";

export const requirePermission =
  (action: Action): RequestHandler =>
  (req, _res, next) => {
    const membership = (req as any).membership;
    if (!membership || !can(membership.role, action)) throw new ForbiddenError("tenant.forbidden");
    next();
  };
```

Used per route: `router.post("/customers", requirePermission("customer.write"), createCustomer)`.

### 6.5 Tenant switch handler

```ts
import { z } from "zod";
import type { RequestHandler } from "express";
import { prisma } from "../../db/client.js";
import { audit } from "../../audit/audit.js";
import { env } from "../../env.js";
import { csrfCookieOptions } from "../../auth/cookies.js";
import crypto from "node:crypto";
import { AppError } from "../../errors/app-error.js";

const Body = z.object({ companyId: z.string() });

export const switchTenant: RequestHandler = async (req, res) => {
  const { companyId } = Body.parse(req.body);
  const session = (req as any).session;
  const user = (req as any).user;

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, companyId, revokedAt: null, acceptedAt: { not: null } },
  });
  if (!membership)
    throw new AppError("tenant.switch_invalid", 400, "Not a member of target tenant");

  const newCsrf = crypto.randomBytes(32).toString("base64url");
  const updated = await prisma.session.update({
    where: { id: session.id },
    data: { activeCompanyId: companyId, csrfSecret: newCsrf },
  });

  res.cookie(env.CSRF_COOKIE_NAME, newCsrf, csrfCookieOptions());
  await audit({
    action: "tenant.switched",
    actorUserId: user.id,
    companyId,
    metadata: { from: session.activeCompanyId, to: companyId },
  });

  res.json({ activeCompanyId: updated.activeCompanyId });
};
```

### 6.6 Tenant context (AsyncLocalStorage)

```ts
// apps/api/src/tenants/tenant-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

interface Ctx {
  companyId: string;
}
const als = new AsyncLocalStorage<Ctx>();

export const runWithTenant = (ctx: Ctx, fn: () => void) => als.run(ctx, fn);
export const getTenantContext = (): Ctx | undefined => als.getStore();
```

> Reminder: this is a **defensive fallback**. All repository functions still accept `companyId` explicitly per [SPEC-0004](./0004-database-and-prisma.md) §6.5.

## 7. Implementation guide

### 7.1 Steps

1. Implement files from §6.
2. Add `tenants` routes to `apps/api/src/app.ts` after auth middleware.
3. Update `LoginResponse` builder ([SPEC-0010](./0010-authentication-and-sessions.md)) to also choose a default `activeCompanyId` when memberships exist.
4. Write integration tests:
   - Two users, one company; only the owner sees it.
   - Tenant switch rotates CSRF cookie.
   - `requireTenant` rejects when membership revoked.
   - Permission denial returns `tenant.forbidden`.

### 7.2 Dependencies

(None new beyond what SPEC-0010 brought in.)

### 7.3 Conventions

- Never read `companyId` from request body in tenant-scoped routes. Always from `req.tenant.id` / `req.membership.companyId`.
- Adding a new permission requires updating `permissions.ts` AND the matrix in this spec (PR diff must include both).

## 8. Acceptance criteria

- **AC-1.** A logged-in user with two memberships can switch tenants; subsequent requests resolve to the new tenant.
- **AC-2.** Switching to a tenant the user isn't a member of returns `400 tenant.switch_invalid`.
- **AC-3.** A request to a tenant-scoped route without `activeCompanyId` returns `403 tenant.not_a_member`.
- **AC-4.** A `VIEWER` role calling `POST /api/v1/customers` returns `403 tenant.forbidden`.
- **AC-5.** Creating a `Company` with an existing RUC returns `409` with `code: "company.duplicate_ruc"` (add code to taxonomy).
- **AC-6.** `tenant.switched` audit log entry exists with `metadata.from` and `metadata.to`.
- **AC-7.** Switching tenants rotates the CSRF token; old token is rejected on next state-changing request.

## 9. Test plan

- Unit tests for `can()` permission helper covering every role × action pair.
- Integration tests as listed in §7.1.

## 10. Security considerations

- Membership lookup is the single source of authorization. No shortcuts.
- `Company.ruc` uniqueness enforced at DB level (`@unique`) AND application (RUC checksum).
- CSRF rotation on tenant switch prevents replaying old tokens against a different tenant.
- A leaked session cookie scoped to a tenant cannot be widened — switching only allowed within the user's memberships.

## 11. Observability

- Audit `tenant.switched`, `membership.invited`, `membership.accepted`, `membership.revoked`.
- Log `tenantId` on every request (set in [SPEC-0006](./0006-error-model-and-logging.md) `runWithContext`).

## 12. Risks and mitigations

| Risk                                                                    | Mitigation                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Forgotten tenant check on a new route                                   | `requireTenant` mounted on the router prefix; ESLint rule for repositories.                                |
| Role drift between matrix and routes                                    | Single `permissions.ts` source; reviewer asserts both updated.                                             |
| Race condition during tenant switch (in-flight request uses old tenant) | Tolerable: each request resolves its tenant at middleware time; in-flight requests use whichever they got. |

## 13. Open questions

- Should an OWNER be able to demote themselves below `ADMIN`? No — at least one OWNER must remain. Enforce in `membership-service.ts`.
- "Recently used tenants" UX? Out of scope.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
