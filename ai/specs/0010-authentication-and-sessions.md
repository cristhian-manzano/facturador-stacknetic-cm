---
id: SPEC-0010
title: Authentication & sessions
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002, SPEC-0003, SPEC-0004, SPEC-0005, SPEC-0006]
blocks: [SPEC-0011, SPEC-0033, SPEC-0041]
---

# SPEC-0010 — Authentication & sessions

> Implements [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) using **Express 5** (not NestJS as the ADR's framework prose suggested — the **decisions** in ADR-0004 are framework-agnostic; only one paragraph mentions NestJS, and the project has since adopted Express 5 per the locked stack).

## 1. Purpose

Build the login surface and the server-side session machinery that every authenticated endpoint depends on. Per [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md): opaque session id in an `httpOnly; Secure; SameSite=Lax` cookie; session row in Postgres; argon2id password hashing; CSRF on state-changing requests; tenant-aware (handled in [SPEC-0011](./0011-tenants-memberships-rbac.md)).

## 2. Scope

### 2.1 In scope

- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- Session creation, rolling expiry, hard cap, revocation.
- CSRF token issuance + verification middleware (header `x-csrf-token`).
- Constant-time login response timing.
- Audit log integration for login success/failure/logout.
- argon2id parameter pin (justified).
- Rate limiting for `/login` (per IP and per email).

### 2.2 Out of scope

- Tenant selection (covered by [SPEC-0011](./0011-tenants-memberships-rbac.md)).
- Email-based password reset (later spec).
- 2FA (later spec).
- SSO / OAuth (later spec).
- Public API token issuance for integrators (per ADR-0004 §11; later ADR).

## 3. Context & references

- [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) — full reasoning.
- [`ai/context/security.md`](../context/security.md) — login error policy, password storage.
- [SPEC-0004](./0004-database-and-prisma.md) — `User`, `Session`, `AuditLog` models.
- [SPEC-0005](./0005-shared-contracts.md) — `LoginRequestSchema`, `LoginResponseSchema`.
- [SPEC-0006](./0006-error-model-and-logging.md) — `AppError`, `audit()`.

## 4. Functional requirements

- **FR-1.** `POST /api/v1/auth/login`
  - Body: `{ email, password }` per `LoginRequestSchema`.
  - On success: writes a `Session` row, sets cookies (session + CSRF), returns `LoginResponse` (user + memberships + activeCompanyId).
  - On failure: returns `401 { code: "auth.invalid_credentials" }` with **identical** timing to success regardless of whether the email exists.
- **FR-2.** `POST /api/v1/auth/logout`
  - Requires session cookie + valid CSRF.
  - Deletes the current session row (hard delete; not soft).
  - Clears cookies.
- **FR-3.** `GET /api/v1/auth/me`
  - Requires session cookie. Returns the same shape as login response, refreshed.
  - Idempotent.
- **FR-4.** Session middleware (`requireSession`) runs on every authenticated route:
  - Reads session cookie; fetches `Session` row.
  - Validates `expiresAt > now` and `revokedAt is null`.
  - Updates `lastSeenAt = now`. Sliding expiry: extends `expiresAt` by rolling window if more than 5 min passed.
  - Hard cap: 90 days from `createdAt`. After that, login required.
  - Attaches `{ session, user, activeCompanyId }` to `req`.
- **FR-5.** CSRF middleware:
  - Issued at login; cookie name from env (`__Host-facturador.csrf`); also returned in `LoginResponse` for header echo by Web.
  - Required header `x-csrf-token` on `POST`, `PUT`, `PATCH`, `DELETE` for authenticated requests.
  - Mechanism: double-submit cookie. The cookie value must equal the header value AND the HMAC of `Session.csrfSecret` matches. Rotation on tenant switch.
- **FR-6.** Argon2id parameters: `type=argon2id, timeCost=3, memoryCost=64MB, parallelism=1`, salt 16 bytes (auto). Documented and benchmarked on the dev container.
- **FR-7.** Rate limiting on `/auth/login`: 5 attempts per (IP) per 60 s and 10 per (email) per 5 min. Burst allowed; exceeded returns `429`.
- **FR-8.** All four events written to audit log: `auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.session.revoked`. `failure` records `email` hashed (not raw).

## 5. Non-functional requirements

- **NFR-1.** Login P95 ≤ 350 ms in dev (argon2 dominates).
- **NFR-2.** Session lookup P95 ≤ 5 ms.
- **NFR-3.** No PII (email, password) appears in any log line.
- **NFR-4.** Cookies pass `__Host-` prefix requirements in production (`Secure`, `Path=/`, no `Domain`).

## 6. Technical design

### 6.1 Module layout

```
apps/api/src/
├── auth/
│   ├── routes.ts                 # mounts /api/v1/auth/*
│   ├── handlers/
│   │   ├── login.ts
│   │   ├── logout.ts
│   │   └── me.ts
│   ├── services/
│   │   ├── session-service.ts    # CRUD on Session
│   │   ├── password.ts           # argon2id hash/verify
│   │   └── rate-limit.ts         # in-memory token bucket (Redis follow-up)
│   ├── middleware/
│   │   ├── require-session.ts
│   │   └── csrf.ts
│   └── cookies.ts                # canonical cookie options builder
└── ...
```

### 6.2 Cookie configuration

```ts
// apps/api/src/auth/cookies.ts
import type { CookieOptions } from "express";
import { env } from "../env.js";

const isProd = env.NODE_ENV === "production";

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
  // Note: __Host- prefix requires Secure + Path=/ + no Domain. Compatible with same-origin or shared parent domain.
  maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days; sliding expiry refreshed server-side
});

export const csrfCookieOptions = (): CookieOptions => ({
  httpOnly: false, // Web must read it to send the x-csrf-token header
  secure: isProd,
  sameSite: "lax",
  path: "/",
});
```

### 6.3 Login handler (sketch)

```ts
// apps/api/src/auth/handlers/login.ts
import type { RequestHandler } from "express";
import { LoginRequestSchema } from "@facturador/contracts/auth";
import { prisma } from "../../db/client.js";
import { verifyPassword } from "../services/password.js";
import { createSession } from "../services/session-service.js";
import { audit } from "../../audit/audit.js";
import { AuthError } from "../../errors/app-error.js";
import { sessionCookieOptions, csrfCookieOptions } from "../cookies.js";
import { env } from "../../env.js";
import { hashIp } from "../../security/ip-hash.js";

export const login: RequestHandler = async (req, res) => {
  const start = Date.now();
  const { email, password } = LoginRequestSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  // Compute hash either way to keep timing constant
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(DUMMY_HASH, password);

  if (!user || !ok || !user.isActive) {
    await audit({
      action: "auth.login.failure",
      metadata: { emailHash: hash(email) },
      ipHash: hashIp(req.ip!),
    });
    await padTiming(start, 350);
    throw new AuthError("auth.invalid_credentials", "Invalid credentials");
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, revokedAt: null, acceptedAt: { not: null } },
    include: { company: true },
  });

  const activeCompanyId = memberships[0]?.companyId ?? null;
  const session = await createSession({
    userId: user.id,
    activeCompanyId,
    userAgent: req.header("user-agent"),
    ip: req.ip,
  });

  res.cookie(env.SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
  res.cookie(env.CSRF_COOKIE_NAME, session.csrfTokenForClient, csrfCookieOptions());

  await audit({
    action: "auth.login.success",
    actorUserId: user.id,
    companyId: activeCompanyId,
    ipHash: hashIp(req.ip!),
  });

  res.json({
    user: { id: user.id, email: user.email, fullName: user.fullName },
    memberships: memberships.map((m) => ({
      companyId: m.companyId,
      razonSocial: m.company.razonSocial,
      role: m.role,
    })),
    activeCompanyId,
  });
};
```

`padTiming` sleeps until the elapsed total reaches the target floor — defends against email-existence timing oracle.

### 6.4 Session service

```ts
// apps/api/src/auth/services/session-service.ts
import { prisma } from "../../db/client.js";
import { ulid } from "ulid";
import crypto from "node:crypto";
import { hashIp } from "../../security/ip-hash.js";

const ROLLING_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const HARD_CAP_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

export const createSession = async (input: {
  userId: string;
  activeCompanyId: string | null;
  userAgent?: string;
  ip: string;
}) => {
  const id = ulid();
  const csrfSecret = crypto.randomBytes(32).toString("base64url");
  const row = await prisma.session.create({
    data: {
      id,
      userId: input.userId,
      activeCompanyId: input.activeCompanyId,
      userAgent: input.userAgent,
      ipHash: hashIp(input.ip),
      csrfSecret,
      expiresAt: new Date(Date.now() + ROLLING_MS),
    },
  });
  // The CSRF token returned to the client is the secret itself (signed cookie option also possible).
  return { ...row, csrfTokenForClient: csrfSecret };
};

export const refreshIfStale = async (sessionId: string) => {
  const now = Date.now();
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) return null;
  if (s.revokedAt || s.expiresAt.getTime() < now) return null;
  if (now - s.createdAt.getTime() > HARD_CAP_MS) return null;
  const staleMs = now - s.lastSeenAt.getTime();
  if (staleMs > 5 * 60_000) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + ROLLING_MS) },
    });
  }
  return s;
};

export const revokeSession = (sessionId: string) =>
  prisma.session.delete({ where: { id: sessionId } });
```

### 6.5 `requireSession` middleware

```ts
import type { RequestHandler } from "express";
import { env } from "../../env.js";
import { refreshIfStale } from "../services/session-service.js";
import { prisma } from "../../db/client.js";
import { AuthError } from "../../errors/app-error.js";

export const requireSession: RequestHandler = async (req, _res, next) => {
  const sid = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!sid) throw new AuthError("auth.session_expired");

  const session = await refreshIfStale(sid);
  if (!session) throw new AuthError("auth.session_expired");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.isActive) throw new AuthError("auth.session_expired");

  (req as any).session = session;
  (req as any).user = user;
  (req as any).activeCompanyId = session.activeCompanyId;
  next();
};
```

### 6.6 CSRF middleware

```ts
import type { RequestHandler } from "express";
import { env } from "../../env.js";
import { AppError } from "../../errors/app-error.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  const cookieToken = req.cookies?.[env.CSRF_COOKIE_NAME];
  const headerToken = req.header("x-csrf-token");
  const session = (req as any).session;
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken !== headerToken ||
    cookieToken !== session?.csrfSecret
  ) {
    throw new AppError("auth.csrf_invalid", 403, "Invalid CSRF token");
  }
  next();
};
```

Mount order: `cookieParser()` → `requestLogger` → `csrfGuard` runs **after** `requireSession` so it can read the session.

### 6.7 Argon2 wrapper

```ts
import argon2 from "argon2";

const PARAMS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 64 * 1024,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string) => argon2.hash(plain, PARAMS);
export const verifyPassword = (digest: string, plain: string) =>
  argon2.verify(digest, plain, PARAMS);
export const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$0000000000000000000000$0000000000000000000000000000000000000000000";
```

### 6.8 Rate limit

In-memory token-bucket keyed by `(ip)` and `(email)` for `/auth/login`. Defined in `apps/api/src/auth/services/rate-limit.ts`. Returns `429` with `Retry-After` header. Backed by Redis in a follow-up spec.

### 6.9 IP hashing

```ts
// apps/api/src/security/ip-hash.ts
import crypto from "node:crypto";

const today = () => new Date().toISOString().slice(0, 10);
const dailySalt = (date = today()) => `facturador:${date}`;

export const hashIp = (ip: string) =>
  crypto
    .createHash("sha256")
    .update(dailySalt() + ip)
    .digest("hex")
    .slice(0, 32);
```

## 7. Implementation guide

### 7.1 Steps

1. Add `argon2`, `cookie-parser`, `express-rate-limit` (or hand-rolled bucket) dependencies to `apps/api`.
2. Implement files from §6.
3. Mount routes in `apps/api/src/app.ts`:
   ```ts
   app.use(cookieParser());
   app.use(requestLogger);
   app.use("/api/v1/auth", authRoutes);
   app.use(requireSession); // applies to everything below
   app.use(csrfGuard);
   ```
4. Write integration tests per §10 of SPEC-0007.
5. Update the demo seed user from [SPEC-0004](./0004-database-and-prisma.md) to satisfy the login flow.

### 7.2 Dependencies (apps/api)

| Package              | Version   | Purpose                                                                    |
| -------------------- | --------- | -------------------------------------------------------------------------- |
| `argon2`             | `^0.41.0` | Password hashing.                                                          |
| `cookie-parser`      | `^1.4.6`  | Parse cookies.                                                             |
| `express-rate-limit` | `^7.4.0`  | Rate limiting (or hand-roll).                                              |
| `helmet`             | `^7.1.0`  | Security headers (already useful here; added in SPEC-0030 if not earlier). |

### 7.3 Conventions

- Cookies named via env, prefixed `__Host-` to enforce Secure + Path=/ + no Domain.
- Session ID is a ULID, opaque, never embeds user info.
- The CSRF token equals `Session.csrfSecret`. It rotates on tenant switch (SPEC-0011).

## 8. Acceptance criteria

- **AC-1.** `POST /api/v1/auth/login` with correct credentials sets two cookies, returns `LoginResponse`, audits success.
- **AC-2.** Same endpoint with wrong password returns `401 auth.invalid_credentials` within ±10 ms of the success-case timing for the same email; audits failure with `emailHash`.
- **AC-3.** Same endpoint with non-existent email also returns `401 auth.invalid_credentials` within the same timing budget.
- **AC-4.** `GET /api/v1/auth/me` without cookie returns `401 auth.session_expired`.
- **AC-5.** `GET /api/v1/auth/me` with valid cookie returns the current user + memberships.
- **AC-6.** `POST /api/v1/auth/logout` deletes the session row, clears cookies, returns `204`.
- **AC-7.** A `POST` request with cookie but no `x-csrf-token` returns `403 auth.csrf_invalid`.
- **AC-8.** A session past hard cap (90 days) is rejected even if `expiresAt` is in the future (artificially constructed test).
- **AC-9.** Rate-limit: 6th login attempt within 60 s from the same IP returns `429`.
- **AC-10.** No password / email plaintext appears in any log line for AC-1..AC-9.

## 9. Test plan

- Unit: `password.ts` (hash + verify roundtrip, wrong password rejects).
- Unit: `session-service.ts` (rolling, hard cap, revoke).
- Integration:
  - Login success / failure / rate-limit / CSRF.
  - Logout invalidates session for subsequent requests.
  - Timing assertion using a tolerance window.
- Property-based test: 1000 random failed logins return identical `code` and `status`.

## 10. Security considerations

- argon2id parameters benchmarked: must keep login ≥ 250 ms to slow brute-force.
- CSRF tokens not logged (redacted by [SPEC-0006](./0006-error-model-and-logging.md) §6.3).
- Cookies have `__Host-` prefix in production; HTTPS-only.
- Session table indexed on `expiresAt` for cheap cleanup; a future spec adds a periodic job to delete expired rows.
- No "remember me" tokens.

## 11. Observability

- Login latency metric (counter + histogram) emitted via logger for now; metrics endpoint added later.
- Audit log entries are the authoritative record; logs are debug-grade.

## 12. Risks and mitigations

| Risk                                    | Mitigation                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Timing oracle reveals account existence | Constant-time path; padTiming + dummy hash.                                                                                         |
| CSRF bypass via token leakage           | Double-submit + HMAC vs session secret; rotation on tenant switch.                                                                  |
| Session fixation                        | New session id on login; old one not reused.                                                                                        |
| Brute force                             | Rate limit per IP + email; future: account lockout after N failures (gated by user feedback to avoid easy DoS of legitimate users). |

## 13. Open questions

- Add account lockout? Not now — risks easy DoS on the user. Revisit when ops experience teaches us.
- Move to Redis-backed sessions? Postgres is fine for current scale (per ADR-0004).

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
