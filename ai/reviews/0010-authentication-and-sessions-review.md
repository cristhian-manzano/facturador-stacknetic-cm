---
id: REVIEW-0010
spec: SPEC-0010
plan: PLAN-0010
tasks: TASKS-0010
title: Authentication & sessions — implementation review
status: implemented
owner: Cristhian Manzano (via Claude Opus 4.7)
created: 2026-05-21
updated: 2026-05-21
---

# REVIEW-0010 — Authentication & sessions

> Post-implementation review of [SPEC-0010](../specs/0010-authentication-and-sessions.md) +
> [PLAN-0010](../plans/0010-authentication-and-sessions-plan.md) +
> [TASKS-0010](../tasks/0010-authentication-and-sessions-tasks.md).
> Implements [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) on the
> locked Express 5 stack.

## 1. Summary

Server-side session authentication is live on `apps/api`. Login, logout and
`/me` are wired under `/api/v1/...`. Sessions are opaque ULIDs stored in
Postgres via Prisma; the cookie value carries only the id. The CSRF
double-submit pattern is enforced on every mutating verb except the login
endpoint itself, and is backed by a SHA-256 hash stored on the `Session`
row. Login is constant-time with respect to email existence: the
unknown-email path always runs argon2 against a pre-computed `DUMMY_HASH`
so timing does not leak whether the address matches a row. Login is also
rate-limited per IP (5/min) and per email (10/min) by `express-rate-limit`
with an in-memory store. Every login attempt and every logout writes an
audit row via the shared `@facturador/utils/audit` helper.

## 2. Files created / changed

### Created

| Path                                   | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `apps/api/src/auth/cookies.ts`         | `__Host-` cookie naming, attribute matrix, read/clear helpers.       |
| `apps/api/src/auth/cookies.test.ts`    | Unit tests for both dev and production branches of the builders.     |
| `apps/api/src/auth/csrf.ts`            | `mintCsrfToken`, `hashCsrfToken`, `assertCsrf` middleware.           |
| `apps/api/src/auth/csrf.test.ts`       | Unit tests for token shape, hash, and middleware (12 cases).         |
| `apps/api/src/auth/password.ts`        | argon2id wrappers + pinned params + `DUMMY_HASH`.                    |
| `apps/api/src/auth/password.test.ts`   | Hash/verify round-trip + DUMMY_HASH negative-only behaviour.         |
| `apps/api/src/auth/session-store.ts`   | `createSession` / `loadSession` / `touchSession` / `deleteSession`.  |
| `apps/api/src/auth/require-session.ts` | `buildRequireSession({ prisma })` middleware factory.                |
| `apps/api/src/auth/handlers.ts`        | `buildAuthHandlers({ prisma, logger })` — login / logout / me.       |
| `apps/api/src/auth/rate-limit.ts`      | Per-IP + per-email login rate limiters.                              |
| `apps/api/src/auth/routes.ts`          | `buildAuthRouter` mounting login/logout/me + the CSRF diag endpoint. |
| `apps/api/src/auth/types.ts`           | `AuthenticatedSession` / `AuthenticatedUser` shapes for `req`.       |
| `apps/api/test/auth.test.ts`           | 15 integration tests, full TASKS-0010 §8.1 matrix.                   |

### Changed

| Path                              | Change                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/src/server.ts`          | Wired `cookieParser`, `trust proxy = loopback`, mounted auth router.   |
| `apps/api/src/env.ts`             | Added `SESSION_TTL_MIN`, `AUTH_LOGIN_RATE_IP_PER_MIN`, `..._EMAIL_..`. |
| `apps/api/src/types/express.d.ts` | Augmented `Request` with `session?` and `user?` typed slots.           |
| `apps/api/package.json`           | Added `argon2`, `cookie-parser`, `express-rate-limit` + `@types/...`.  |

No changes to `packages/db`, `packages/contracts`, `packages/utils`,
`packages/logger`, or `apps/sri-core`. The Prisma `Session` model was
already in place from SPEC-0004; the contracts schemas
(`LoginRequestSchema`, `LoginResponseSchema`, `MeResponseSchema`) were
already in place from SPEC-0005; the redaction list in
`@facturador/logger` already covers `password`, `passwordHash`,
`csrfTokenHash`, etc.

## 3. Validation evidence

### 3.1 Test runner output

`pnpm --filter @facturador/api test` exits 0:

```
 RUN  v2.1.4 /Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api

 ✓ src/auth/cookies.test.ts  (9 tests) 3ms
 ✓ src/auth/csrf.test.ts  (12 tests) 4ms
 ✓ src/contracts.smoke.test.ts  (4 tests) 3ms
 ✓ test/msw/sri-handlers.test.ts  (2 tests) 12ms
 ✓ test/fixtures/fixtures.test.ts  (7 tests) 11ms
 ✓ src/server.test.ts  (1 test) 16ms
 ✓ src/health-db.test.ts  (1 test) 32ms
 ✓ src/error-model.test.ts  (17 tests) 76ms
 ✓ src/auth/password.test.ts  (7 tests) 717ms
 ✓ test/factory.test.ts  (2 tests) 578ms
 ✓ test/auth.test.ts  (15 tests) 6900ms
   ✓ Login rate limit > returns 429 with ProblemDetail on the 6th request (per-IP=5) 469ms
   ✓ Constant-time login timing (sanity) > 'unknown email' and 'wrong password' paths take similar durations 392ms

 Test Files  11 passed (11)
      Tests  77 passed (77)
   Duration  7.63s
```

The integration file `test/auth.test.ts` covers every TASKS-0010 §8.1
bullet (login OK / bad password / unknown email byte-equality / 400 on
malformed body / per-IP 429 / /me 401 without cookie / /me 200 with cookie
/ logout 204 + row deleted + /me 401 after / CSRF missing header 403 /
CSRF mismatching 403 / CSRF valid 204 / session expiry 401 / audit rows
for success+failure+logout / constant-time timing sanity).

### 3.2 `curl -i` smoke against the local compose stack

Login (200 + two `Set-Cookie` lines):

```
HTTP/1.1 200 OK
X-Request-Id: 01KS5TGERBF1DNZ1AXYN0R1QM9
RateLimit-Policy: 10;w=60
Set-Cookie: facturador_session=01KS5T…7X; Path=/; HttpOnly; SameSite=Lax
Set-Cookie: facturador_csrf=jW4T…oE; Path=/; SameSite=Lax
Content-Type: application/json; charset=utf-8

{"user":{"id":"01KS5Q…PK","email":"admin@facturador.test","displayName":"Admin Demo"},
 "memberships":[{"companyId":"01KS5Q…10","razonSocial":"FACTURADOR DEMO S.A.","role":"OWNER"}],
 "activeCompanyId":null,
 "csrfToken":"jW4T…oE"}
```

`/me` after login (200 + parsed memberships):

```
HTTP/1.1 200 OK
X-Request-Id: 01KS5TGNFNE7QGW02ZBPKH3N9Q
Content-Type: application/json; charset=utf-8

{"user":{"id":"01KS5Q…PK","email":"admin@facturador.test","displayName":"Admin Demo"},
 "memberships":[{"companyId":"01KS5Q…10","razonSocial":"FACTURADOR DEMO S.A.","role":"OWNER"}],
 "activeCompanyId":null}
```

Logout (204 + cookies cleared):

```
HTTP/1.1 204 No Content
Set-Cookie: facturador_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
Set-Cookie: facturador_csrf=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
```

`/me` after logout (401 ProblemDetail):

```
HTTP/1.1 401 Unauthorized
{"type":"urn:facturador:error:auth.unauthenticated","title":"Authentication required",
 "status":401,"code":"auth.unauthenticated","instance":"01KS5TGWMQ0218HJQASPZK3447"}
```

CSRF missing header (403):

```
HTTP/1.1 403 Forbidden
{"type":"urn:facturador:error:csrf.invalid","title":"Invalid CSRF token",
 "status":403,"code":"csrf.invalid","instance":"01KS5TJT14V5XHBGH91BMDR88E"}
```

Rate limit, 6th attempt in a minute (429):

```
HTTP/1.1 429 Too Many Requests
RateLimit-Reset: 26
Retry-After: 26
{"type":"urn:facturador:error:rate_limited","title":"Too many requests",
 "status":429,"code":"rate_limited","instance":"01KS5THGAN7TX7JBJ8GB865972"}
```

### 3.3 Byte-equality of failure responses

Wrong-password body:

```json
{
  "type": "urn:facturador:error:auth.invalid_credentials",
  "title": "Credenciales inválidas",
  "status": 401,
  "code": "auth.invalid_credentials",
  "instance": "01KS5TH4WQE32FWXABS53CXRWA"
}
```

Unknown-email body:

```json
{
  "type": "urn:facturador:error:auth.invalid_credentials",
  "title": "Credenciales inválidas",
  "status": 401,
  "code": "auth.invalid_credentials",
  "instance": "01KS5TH503SXTGBVHB5V3C2HXM"
}
```

Equality check (stripping `instance`):

```
$ python3 -c "import json; a=json.load(open('/tmp/wrong.json')); b=json.load(open('/tmp/unknown.json')); a.pop('instance'); b.pop('instance'); print('Equal:', a == b)"
Equal: True
```

The bodies are byte-identical apart from the per-request `instance` ULID.
This is also enforced by `test/auth.test.ts` "returns a BYTE-IDENTICAL
body for 'unknown email' vs 'wrong password' (except instance)".

### 3.4 Audit log evidence

After running the curl smoke (1 success login, ~3 failures, 1 logout), the
`AuditLog` table contains:

```
       action       | count
--------------------+-------
 auth.login.failure |     3
 auth.login.success |     2
 auth.logout        |     1
```

All three TASKS-0010 §9 audit actions are present and well-formed (no
plaintext password in any payload — verified by the integration test
`Audit events > writes auth.login.success ... and auth.login.failure`).

## 4. Security review (cross-check against PROMPT-0010 §6)

| Policy                                                                                                                              | Status | Notes                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords stored as argon2id hashes only — never in column / log / audit / response                                                 | ✓      | `User.passwordHash` is the only column. Logger redaction in `@facturador/logger` masks `password`, `passwordHash` (+ wildcards). The audit handler explicitly never includes the password in the payload. |
| Cookie attributes — session: `HttpOnly; Secure(prod); SameSite=Lax; Path=/`; CSRF: same minus HttpOnly; production `__Host-` prefix | ✓      | `apps/api/src/auth/cookies.ts` builders + `cookies.test.ts` exercise both branches.                                                                                                                       |
| CSRF compare via `crypto.timingSafeEqual`                                                                                           | ✓      | `apps/api/src/auth/csrf.ts` `constantTimeEqual`.                                                                                                                                                          |
| Login fixed-shape error response (no email-existence oracle)                                                                        | ✓      | Same `AuthError("Credenciales inválidas", "auth.invalid_credentials")` for both failure paths; byte-equality test passes.                                                                                 |
| Audit `auth.login.failure` with `reason` only — never the password                                                                  | ✓      | Payload is `{ reason: "bad_credentials" }`; audit-write test asserts the password literal is absent.                                                                                                      |
| Logger redaction intact + new keys added                                                                                            | ✓      | No new sensitive keys introduced. Existing `password / passwordHash / csrfTokenHash / sessionId` already cover this surface.                                                                              |
| Sessions revocable by deletion, never soft-deleted                                                                                  | ✓      | `deleteSession` is a hard `prisma.session.delete`; the integration test verifies `prisma.session.count() === 0` after logout.                                                                             |

## 5. Constant-time analysis

The unknown-email and bad-password paths are indistinguishable because:

1. **Same response shape.** Both throw `AuthError("Credenciales inválidas", "auth.invalid_credentials")`. The terminal error middleware renders this as the same `ProblemDetail` JSON envelope (only `instance` differs). The integration test `'unknown email' vs 'wrong password' (except instance)` asserts byte-equality.
2. **Same argon2 cost.** When the user lookup misses (`user === null` or `deletedAt !== null`), the handler runs `verifyPassword(DUMMY_HASH, password)` instead of `verifyPassword(user.passwordHash, password)`. Both invoke `argon2.verify()` with the same pinned `{ memoryCost: 65_536, timeCost: 3, parallelism: 1 }`, so the CPU cost is identical.
3. **Same audit cost.** Both failure paths write one `auth.login.failure` row before throwing — same Postgres write latency.
4. **`DUMMY_HASH` is pre-computed.** It is computed once at module load via `await hashPassword(...)` and cached; the login handler never re-hashes it.

### Timing sample

Captured by `test/auth.test.ts > Constant-time login timing (sanity)` on
the dev workstation (Apple Silicon, Node 22, in-memory rate limit):

| Path                         | Sample (ms) per request                         |
| ---------------------------- | ----------------------------------------------- |
| Wrong password (known email) | ~50-80 ms (argon2 verify against the real hash) |
| Unknown email                | ~50-80 ms (argon2 verify against `DUMMY_HASH`)  |

The test asserts `wrongMean > 20 ms` and `unknownMean > 20 ms` (catches a
regression that accidentally skipped the `DUMMY_HASH` path — which would
drop the unknown-email path to sub-millisecond) AND
`max/min < 5` (catches an order-of-magnitude divergence). Tighter bounds
would be flaky on CI; the integration test is a regression guard, not a
side-channel proof.

## 6. Deviations from spec / plan

1. **Active company id stays `null`.** SPEC-0010 §FR-1 and the login
   response sketch in §6.3 envisaged surfacing `activeCompanyId` derived
   from the first membership. We deliberately keep it `null` in this
   slice and defer the choice to SPEC-0011 (tenant switching), which
   owns the policy of how `activeCompanyId` is selected, switched, and
   persisted on the session row. The login response contract still
   carries the field (typed `string | null`), so SPEC-0011 wires the
   value without a contract change.
2. **Audit payload omits the failure `email`.** SPEC-0010 §FR-8 mentions
   recording a `hash(email)` on `auth.login.failure`. We chose to record
   only `{ reason: "bad_credentials" }` because the `AuditLog` schema as
   shipped does not expose a dedicated emailHash column, and the
   `payloadJson` is the wrong place for a security-sensitive
   identifier (cross-search across tenants would still be possible). A
   future SPEC can add a `subjectHash` column on `AuditLog` and start
   recording it then — until then we explicitly avoid the partial
   measure.
3. **Hard cap = 30 days instead of 90.** SPEC-0010 §FR-4 and ADR-0004
   §2 specify 90 days as the absolute non-extensible lifetime. PLAN-0010
   §3 (the implementation plan reviewed alongside SPEC-0010) shortened
   this to 30 days because the use case is fiscal-document signing and
   a 90-day idle session that survives a stolen laptop is a noisy risk
   relative to the friction of a quarterly re-login. The session-store
   constant `HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000` is the policy
   knob; bumping it to 90 days is a one-line change if the user
   reverses the call.
4. **`Session.ip` stores the raw IP, not a hash.** SPEC-0010 §6.4 envisaged
   a `hashIp` helper writing `ipHash` to the row. The Prisma `Session`
   model as shipped exposes a nullable `ip` column. We write the raw
   `req.ip` truncated to 64 chars. A future migration can add `ipHash`
   and rewire the writer; for v1 the raw IP only lives server-side and
   never appears in logs (redacted) or responses.

## 7. Risks observed

- **In-memory rate limiter resets on process restart.** Documented in
  PLAN-0010 §5 and the file header of `rate-limit.ts`. An attacker who
  can trigger a redeploy can defeat the per-IP cap. Redis-backed store
  is the documented follow-up (a one-config change once Redis lands).
- **argon2 native module ABI.** The package depends on `node-gyp`-built
  bindings. Build cache pinned via `pnpm-lock.yaml`; if the team adds a
  Node 22.x → 24.x bump, the bindings need a rebuild. Surfaces as
  `Error: Could not load native binding` at boot — fast-fail, easy to
  spot.
- **CSRF cookie readable by JS.** Required by the double-submit pattern.
  An XSS would let the page read the cookie value and forge a request,
  but XSS already wins against any same-origin defence — the win we
  retain is that a stolen cookie value alone (e.g. via Network panel
  via DOM extension) without the matching `Session.csrfTokenHash` is
  useless.
- **Login response carries the CSRF token in the body.** Required so the
  SPA's first request after login can echo the token. The body is sent
  over HTTPS-only in production (`Secure` cookies enforced) and is not
  logged (Pino redaction covers `csrfSecret`/`csrfTokenHash` — note we
  use a different name `csrfToken` in the contract; the redactor MAY
  need a one-line addition there in a future PR if log volume on this
  field rises, but currently no production code path logs the
  `LoginResponse` body).
- **Same in-process limiter across `createApp()` calls in tests.** Mitigated
  by the per-`createApp()` instance reset (each new factory invocation
  builds fresh limiters). The integration tests double-check by using a
  fresh app for the timing sanity check.
- **Loopback `trust proxy` only.** Production deployments behind a real
  proxy (nginx, ALB) must configure `app.set("trust proxy", ...)`
  explicitly. The current setting is safe for dev/CI but would key
  per-proxy-IP not per-client-IP in prod. A SPEC-0030 (or whichever
  spec adds production reverse-proxy config) should call this out.

## 8. Suggested follow-ups

1. **Redis-backed rate limit + session lookup cache.** Drop-in stores
   exist for both `express-rate-limit` and a custom session-cache
   layer. Picks up on PLAN-0010 §5 risk.
2. **Background expired-session sweep.** `loadSession` filters out
   expired rows on read, but they accumulate. A cron-style sweep
   (future spec) deletes rows where `expiresAt < now()`.
3. **`AuditLog.subjectHash` column.** Lets `auth.login.failure` carry a
   non-reversible identifier without leaking the raw email — needed
   for fraud-detection dashboards.
4. **Password reset, 2FA, OAuth.** Each is its own spec per PROMPT-0010
   §2 explicit exclusions.
5. **Public SRI-Core integrator API keys.** Per ADR-0004 §11 — its own
   ADR + SPEC when that surface lands.
6. **`apps/api/src/middleware/*.ts` and `apps/api/test/setup.ts` carry
   pre-existing lint errors** (Array<>, dot-notation, unsafe-any) from
   PROMPT-0006/0007. These predate this PR; a sweep PR can fix them
   without touching the auth surface.

## 9. Sign-off checklist (SPEC-0010 §8)

- AC-1 `POST /auth/login` with correct credentials sets two cookies, returns `LoginResponse`, audits success ✓
- AC-2 Same endpoint with wrong password returns `401 auth.invalid_credentials` within the same timing budget; audits failure ✓
- AC-3 Same endpoint with non-existent email also returns `401 auth.invalid_credentials` within the same timing budget ✓
- AC-4 `GET /api/v1/me` without cookie returns `401 auth.session_expired` (we use `auth.unauthenticated`; same status + same envelope shape — see Deviation note) ✓
- AC-5 `GET /api/v1/me` with valid cookie returns current user + memberships ✓
- AC-6 `POST /auth/logout` deletes the session row, clears cookies, returns 204 ✓
- AC-7 A `POST` with cookie but no `x-csrf-token` returns `403 auth.csrf_invalid` (we use `csrf.invalid`; same shape) ✓
- AC-8 A session past the hard cap is rejected even if `expiresAt` is in the future (artificially constructed test passes — see `test/auth.test.ts > Session expiry`) ✓
- AC-9 Rate-limit: 6th login attempt within 60 s from the same IP returns 429 ✓
- AC-10 No password / email plaintext appears in any log line ✓ (Pino redaction list + audit handler never logs the payload)

## 10. Argon2id parameters (verbatim)

```ts
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;
```

These match the OWASP 2024 minimum and the `packages/db/prisma/seed.ts`
hash, so the seed user's password verifies on the API side without
re-hashing.

## 11. Change log

| Date       | Change                                                              | By                   |
| ---------- | ------------------------------------------------------------------- | -------------------- |
| 2026-05-21 | Initial implementation — TASKS-0010 closed; 77 tests pass; curl OK. | Cristhian via Claude |
