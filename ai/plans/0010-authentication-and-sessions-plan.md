---
id: PLAN-0010
spec: SPEC-0010
title: Authentication & sessions — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0010 — Authentication & sessions

> Implementation plan for [SPEC-0010](../specs/0010-authentication-and-sessions.md). Implements [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md). Depends on PLAN-0004/0005/0006/0007.

## 1. Goal

Stand up server-side session auth for `apps/api`:

- `POST /api/v1/auth/login` — argon2id verify; create `Session` row; set `__Host-` cookies (prod) / plain cookies (dev) with `httpOnly; Secure; SameSite=Lax`.
- `POST /api/v1/auth/logout` — invalidate the session row and clear cookies.
- `GET /api/v1/me` — returns current user + tenants.
- `requireSession` middleware loads the session, attaches `req.session`, `req.user`.
- CSRF double-submit guard for all mutating verbs.
- Rate limiting on login (per-IP + per-email).
- Constant-time response on bad credentials; same body for "unknown email" and "wrong password".

## 2. Inputs

- [SPEC-0010](../specs/0010-authentication-and-sessions.md) — authoritative.
- [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) — strategy chosen.
- [SPEC-0004](../specs/0004-database-and-prisma.md) — `User`, `Session`, `Membership` models.
- [SPEC-0005](../specs/0005-shared-contracts.md) — `LoginRequestSchema`, `MeResponseSchema`.
- [SPEC-0006](../specs/0006-error-model-and-logging.md) — ProblemDetail, validateBody, audit.
- [ai/context/security.md](../context/security.md) — argon2id params, cookie attributes.

## 3. Architecture decisions

| Decision                                                                                                                                                                               | Rationale                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Server-side opaque session token** (ULID). Cookie value = session id only.                                                                                                           | No server-side state in the token; revocation is row-level.                         |
| **CSRF double-submit**: random `csrfToken` minted with the session; sent as `__Host-facturador_csrf` cookie + must be echoed in `X-CSRF-Token` header by the SPA on mutating requests. | Industry-standard; works across subdomains.                                         |
| Cookie names dev vs prod: dev uses `facturador_session` / `facturador_csrf` (no `__Host-` because no TLS), prod uses `__Host-facturador_session` / `__Host-facturador_csrf`.           | `__Host-` prefix requires `Secure` + path=/ + no Domain — only feasible over HTTPS. |
| Session TTL: 8 h (`SESSION_TTL_MIN=480`). Sliding window: `lastSeenAt` updated on every authenticated request. Absolute max-life: 30 days (re-login required).                         | Balance UX vs risk.                                                                 |
| Login rate limiting: 5/min per IP, 10/min per email (whichever stricter).                                                                                                              | Block brute force without locking real users.                                       |
| Argon2id params: `memoryCost: 65536, timeCost: 3, parallelism: 1`.                                                                                                                     | OWASP-aligned.                                                                      |
| Constant-time response: same `ProblemDetail` body, same HTTP 401, and a tiny artificial delay (~100–200 ms) on failed login regardless of cause.                                       | Mitigates user enumeration.                                                         |
| Sessions stored in `Session` table; cookies hold only the session id. CSRF token hashed at rest (`csrfTokenHash = sha256(csrfToken)`).                                                 | Stealable cookies cannot expose the CSRF token even if the DB leaks.                |
| Logout deletes the row + clears both cookies.                                                                                                                                          | Clean.                                                                              |
| `requireSession` middleware extends the row's `expiresAt` on each hit (sliding window) up to absolute max.                                                                             | Smooth UX without explicit refresh.                                                 |

## 4. Phases

### Phase 1 — Cookie + CSRF helpers

`apps/api/src/auth/cookies.ts`:

- `setSessionCookies(res, { sessionId, csrfToken })` — picks prefix based on `NODE_ENV`.
- `clearSessionCookies(res)`.
- `readSessionCookie(req)`, `readCsrfCookie(req)`.

`apps/api/src/auth/csrf.ts`:

- `mintCsrfToken()` — 32-byte random base64.
- `hashCsrfToken(token)` — sha256 hex.
- `assertCsrf(req)` — middleware that for mutating methods compares the cookie value's hash to the stored `csrfTokenHash` AND requires header `X-CSRF-Token` matches the cookie (double-submit).

### Phase 2 — Argon2 service

`apps/api/src/auth/password.ts`:

- `hashPassword(plain)` and `verifyPassword(hash, plain)` wrappers around `argon2`.
- Constant params from env or constants file.

### Phase 3 — Login / logout / me handlers

`apps/api/src/auth/handlers.ts`:

- `loginHandler` validates body with `LoginRequestSchema`, looks up user (lowercased email), runs argon2 verify, on success creates a `Session` row, mints CSRF, sets cookies, returns `LoginResponseSchema` body. Failure path: small randomised delay + identical 401.
- `logoutHandler` deletes the session row, clears cookies, returns 204.
- `meHandler` returns `MeResponseSchema` body.

### Phase 4 — Middleware

- `requireSession`: reads session cookie, looks up row, asserts `expiresAt > now`, attaches `req.session`, `req.user`, extends `lastSeenAt` + `expiresAt`. Throws `AuthError` otherwise.
- `assertCsrf`: as Phase 1 — applied globally for mutating verbs but bypassed for `POST /api/v1/auth/login` (no session yet) — login uses other anti-CSRF means (same-origin policy + form not allowed via cross-site fetch by default).

### Phase 5 — Rate limiting

Use `express-rate-limit` with `memory-cache` store for dev; document Redis store as a follow-up.

- 5/min per IP at `/auth/login`.
- 10/min per email — implement a tiny custom keyer based on body.email.
- On limit: 429 + ProblemDetail `code: rate_limited`.

### Phase 6 — Audit events

Emit audit rows from `audit()` helper:

- `auth.login.success`
- `auth.login.failure` (with reason `bad_credentials` or `rate_limited` — never with the attempted password)
- `auth.logout`

### Phase 7 — Tests

- Unit: `password.test.ts` (hash/verify round-trip; wrong password fails).
- Unit: `csrf.test.ts` (mint, hash, validate).
- Integration: `auth.test.ts` (Supertest):
  - Login OK: 200, cookies set, body validates.
  - Login bad password: 401, generic body.
  - Login non-existent email: 401, same body shape as bad password (constant-time enumeration test).
  - `/me` without cookie: 401.
  - `/me` with cookie: 200, body validates.
  - Logout deletes the row.
  - Mutating endpoint without CSRF header: 403.
  - Rate limit: 6th login attempt in a minute: 429.

## 5. Risks & mitigations

| Risk                                              | Mitigation                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing side-channel exposes email existence.      | Always run argon2 (against a dummy hash) when the email is unknown; randomised 100–200 ms delay regardless.                                                                |
| CSRF cookie leaks via JS bug.                     | `httpOnly` MUST be false on the CSRF cookie (the SPA reads it), but `Secure` + `SameSite=Strict` mitigates the rest. SameSite=Lax acceptable per ADR but reviewed in code. |
| Session fixation.                                 | Always issue a fresh session id on login — never reuse a previous id.                                                                                                      |
| Race on session expiry.                           | Use `WHERE expiresAt > NOW()` in the session lookup; never trust the cookie alone.                                                                                         |
| In-memory rate limiter resets on process restart. | Acceptable for v1; documented as a follow-up to swap for Redis in prod.                                                                                                    |
| Argon2 native module fails on CI.                 | Pin a known good version; add a Node ABI matrix to CI later.                                                                                                               |

## 6. Validation strategy

- All TASKS-0010 acceptance criteria pass.
- Constant-time test: the response body for "unknown email" and "wrong password" is byte-identical (apart from request-id).
- Rate limit test triggers a 429 on the 6th attempt.
- CSRF test confirms the absence of the header fails with 403 and the presence + match succeeds.
- Manual smoke: `curl -i -X POST /api/v1/auth/login` with seed credentials returns 200 with `Set-Cookie` lines.

## 7. Exit criteria

- All SPEC-0010 ACs pass.
- Cookies use `__Host-` prefix when `NODE_ENV=production`.
- No leakage of email existence in error responses.
- Sessions revocable by deleting rows.

## 8. Out of scope

- Tenant switching → SPEC-0011.
- Password reset flow → later spec.
- 2FA → later spec.
- Integrator API keys → ADR + later spec.
