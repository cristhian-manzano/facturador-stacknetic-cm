---
id: TASKS-0010
spec: SPEC-0010
plan: PLAN-0010
title: Authentication & sessions — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0010 — Authentication & sessions

> Checklist for [SPEC-0010](../specs/0010-authentication-and-sessions.md) + [PLAN-0010](../plans/0010-authentication-and-sessions-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never log the plaintext password (audit row stores only outcome + reason).
- ❌ Never echo whether an email exists.
- ❌ Never reuse a session id after logout.
- ❌ Never accept a CSRF token via query string.
- ✅ Argon2id verify runs on EVERY login attempt — even for unknown emails (against a dummy hash) — to keep timing constant.
- ✅ All mutating endpoints assert CSRF (except the login endpoint itself, by design).

## 1. Cookie helpers

- [ ] **1.1** Create `apps/api/src/auth/cookies.ts`:
  - `setSessionCookies(res, { sessionId, csrfToken })`.
  - `clearSessionCookies(res)`.
  - `readSessionCookie(req)`, `readCsrfCookie(req)`.
  - Names: `__Host-facturador_session` / `__Host-facturador_csrf` when `process.env.NODE_ENV === "production"`, else `facturador_session` / `facturador_csrf`.
  - Attributes: session cookie `HttpOnly; Secure; SameSite=Lax; Path=/`; CSRF cookie `Secure; SameSite=Lax; Path=/` (NOT HttpOnly so SPA can read).
  - In production: `Secure` always; in dev (no TLS): drop `Secure` to allow `localhost`.
    **Validate**: unit test calling `setSessionCookies` against a stub `res` asserts the `Set-Cookie` strings match expected attributes for both NODE_ENV branches.

## 2. CSRF helpers + middleware

- [ ] **2.1** `apps/api/src/auth/csrf.ts`: `mintCsrfToken()`, `hashCsrfToken(token)` (sha256 hex).
      **Validate**: unit test: minted token length = 43 (base64url 32 bytes); hash deterministic.

- [ ] **2.2** `assertCsrf` middleware: for `POST/PUT/PATCH/DELETE` requests (skip `/api/v1/auth/login`):
  - Read CSRF cookie value, hash it, compare to `req.session.csrfTokenHash`.
  - Read `X-CSRF-Token` header; must equal cookie value (double-submit).
  - Constant-time string compare via `crypto.timingSafeEqual`.
  - On mismatch: throw `ForbiddenError` with `code: "csrf_invalid"`.
    **Validate**: Supertest:
  - With no header: 403.
  - With header but mismatching cookie: 403.
  - With header equal to cookie + correct stored hash: passes through.

## 3. Argon2 password service

- [ ] **3.1** `apps/api/src/auth/password.ts`:

  ```ts
  import argon2 from "argon2";
  const OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
  export const hashPassword = (plain) => argon2.hash(plain, OPTS);
  export const verifyPassword = (hash, plain) => argon2.verify(hash, plain);
  ```

  **Validate**: unit test hash→verify true; wrong password verify false.

- [ ] **3.2** Pre-compute a dummy hash at module load for constant-time path:
  ```ts
  export const DUMMY_HASH = await hashPassword("dummy_constant_value_for_timing");
  ```
  (or lazily memoize on first miss).
  **Validate**: unit test: `verifyPassword(DUMMY_HASH, "anything")` returns false; behaviour confirmed stable.

## 4. Session row lifecycle

- [ ] **4.1** `apps/api/src/auth/session-store.ts`:
  - `createSession({ userId, companyId?, ip, userAgent }): { sessionId, csrfToken }`.
  - `loadSession(sessionId)` returns the row or null; rejects expired sessions.
  - `touchSession(sessionId)` updates `lastSeenAt` and slides `expiresAt` (cap at absolute 30-day max from `createdAt`).
  - `deleteSession(sessionId)`.
    **Validate**: integration tests against a test-schema Prisma client verifying each operation.

## 5. Handlers

- [ ] **5.1** `apps/api/src/auth/handlers.ts`:
  - `loginHandler` validates body with `LoginRequestSchema`. Looks up user by lowercased email. If not found, run `verifyPassword(DUMMY_HASH, password)` anyway; either way on failure return 401 with generic body after ~100–200 ms randomized delay. On success: create session, set cookies, return `LoginResponseSchema` body (user summary + tenants from memberships).
  - `logoutHandler`: requires session; deletes row; clears cookies; 204.
  - `meHandler`: requires session; loads user + memberships; returns `MeResponseSchema` body.
    **Validate**: see §8.

## 6. `requireSession` middleware

- [ ] **6.1** `apps/api/src/auth/require-session.ts`: load session, attach `req.session` and `req.user`; touch session; if missing/expired, throw `AuthError`.
      **Validate**: unit test with mock req/res.

## 7. Rate limiting

- [ ] **7.1** Install `express-rate-limit`. Configure two limiters:
  - IP-based: `windowMs: 60_000, max: 5` on `/auth/login`.
  - Email-based: custom keyer reading `req.body.email?.toLowerCase()`; window 60 s, max 10.
  - On block: throw `RateLimitError` (passes through error handler → 429 + ProblemDetail).
    **Validate**: Supertest test: 6th request in 1 minute from same IP returns 429.

## 8. Integration tests

- [ ] **8.1** `apps/api/test/auth.test.ts` exercises:
  - Login OK with seed credentials: 200, `Set-Cookie` for session + csrf, body validates `LoginResponseSchema.parse(...)`.
  - Login bad password: 401, body validates `ProblemDetailSchema.parse(...)`.
  - Login non-existent email: 401, body **byte-identical** to bad-password (apart from request-id), and request duration similar (within reasonable bound).
  - `/me` with valid cookie: 200, `MeResponseSchema.parse(...)`.
  - `/me` without cookie: 401.
  - Logout: 204, session row gone, repeat `/me` → 401.
  - Mutating endpoint without CSRF header: 403.
  - Mutating endpoint with mismatching CSRF: 403.
  - Mutating endpoint with valid CSRF: passes through (use a stub authenticated route).
    **Validate**: `pnpm --filter @facturador/api test apps/api/test/auth.test.ts` exits 0; all subtests green.

## 9. Audit events

- [ ] **9.1** Emit audit rows via `audit(prisma, ...)` from `@facturador/utils`:
  - `auth.login.success` (with userId, ip, userAgent).
  - `auth.login.failure` (reason `bad_credentials` or `rate_limited`; never the password).
  - `auth.logout`.
    **Validate**: integration test asserts the AuditLog row exists after login success and after a failed login.

## 10. Manual smoke

- [ ] **10.1** With compose Postgres running and seeded:

  ```bash
  curl -i -X POST http://localhost:3000/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"email":"admin@facturador.test","password":"Admin123!"}'
  ```

  **Validate**: status 200; response contains two `Set-Cookie` lines for session + csrf; body validates `LoginResponseSchema`.

- [ ] **10.2** Then:
  ```bash
  curl -i http://localhost:3000/api/v1/me -b session.cookie.jar -c session.cookie.jar
  ```
  **Validate**: 200; body validates `MeResponseSchema`.

## 11. Acceptance criteria

- [ ] AC-1: argon2id params meet OWASP 2024 minimums.
- [ ] AC-2: Login is constant-time wrt email existence (verified via byte-identical body + similar duration).
- [ ] AC-3: Sessions are server-side rows; ID is opaque ULID.
- [ ] AC-4: CSRF double-submit enforced on all mutating verbs (except login).
- [ ] AC-5: Cookies use `__Host-` prefix in production.
- [ ] AC-6: Logout deletes the row.
- [ ] AC-7: Rate limiter triggers 429 above thresholds.
- [ ] AC-8: Audit log records login success / failure / logout (without passwords).

## 12. Definition of Done

- All boxes ticked; all forced-failure tests fail as designed and recover.
- Manual curl smoke succeeds.
- Review file `ai/reviews/0010-authentication-and-sessions-review.md` written.
