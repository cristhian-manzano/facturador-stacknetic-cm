---
id: PROMPT-0010
spec: SPEC-0010
plan: PLAN-0010
tasks: TASKS-0010
title: Execute TASKS-0010 — Authentication & sessions
---

# PROMPT-0010 — Execute authentication & sessions

You are an autonomous senior backend security engineer. Execute **TASKS-0010**: build server-side session auth with argon2id, opaque ULID session IDs, CSRF double-submit, rate limiting, and constant-time login.

---

## 1. Mandatory reading

1. `ai/specs/0010-authentication-and-sessions.md` — authoritative.
2. `ai/plans/0010-authentication-and-sessions-plan.md`.
3. `ai/tasks/0010-authentication-and-sessions-tasks.md`.
4. `ai/decisions/ADR-0004-auth-session-strategy.md` — the decision record. (Note: ADR mentions NestJS in prose; the framework is **Express 5** per SPEC-0000/0010 — the decisions in the ADR are framework-agnostic; only the framework choice differs.)
5. `ai/specs/0004-database-and-prisma.md` — `User`, `Session`, `Membership` models.
6. `ai/specs/0005-shared-contracts.md` — `LoginRequestSchema`, `MeResponseSchema`.
7. `ai/specs/0006-error-model-and-logging.md` — `ProblemDetail`, `audit()`, `validateBody`.
8. `ai/specs/0007-testing-strategy.md` — Vitest + Supertest + per-test schema harness.
9. `ai/context/security.md` — cookie attributes, argon2id params, must-never-log list.
10. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Implement only what TASKS-0010 lists.
- ❌ Do NOT implement tenant switching (SPEC-0011 owns it).
- ❌ Do NOT add password-reset, 2FA, OAuth, magic links.
- ❌ Do NOT store CSRF tokens in localStorage; double-submit cookie pattern only.
- ❌ Do NOT log plaintext passwords anywhere, including audit rows.
- ❌ Do NOT echo whether an email exists in error responses.

## 3. Stack constraints

- Express 5 (async handlers + the existing error middleware from SPEC-0006).
- argon2 npm package; `type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1`.
- `express-rate-limit` (memory store for v1; Redis is a documented follow-up).
- ULID for session IDs.
- Prisma 5 for `Session` / `User` / `Membership` access.
- TypeScript strict; ESM only.
- All Zod parsing through `@facturador/contracts/auth`.

## 4. Code quality bar

- Constant-time string comparisons use `crypto.timingSafeEqual`.
- Argon2 verify is invoked on every login attempt (with a dummy hash for unknown emails) to keep timing flat.
- Login failure body is byte-identical regardless of cause; only `instance` (request-id) varies.
- Cookies set via a helper, never by hand-crafted `Set-Cookie` strings in handlers.
- Session row is **always** rotated on login (no reuse).
- All input parsed with `validateBody(LoginRequestSchema)`; never read body fields outside the schema.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test apps/api/test/auth.test.ts` exits 0.
- Constant-time check: capture the response body bytes for "wrong password" and "unknown email"; byte-equal except `instance`.
- Manual `curl` against the running compose stack (TASKS §10.1, §10.2) returns the expected status and `Set-Cookie` lines.
- Forced-failure validations: missing CSRF → 403, mismatching CSRF → 403, 6th rapid login → 429.
- All audit rows present after corresponding flows.

If any check fails, fix the cause; do not weaken constraints.

## 6. Security considerations (verbatim from project policy)

- Passwords stored as argon2id hashes only; never in any column, log, audit row, or response.
- Cookie attributes:
  - Session cookie: `HttpOnly; Secure (prod); SameSite=Lax; Path=/`.
  - CSRF cookie: `Secure (prod); SameSite=Lax; Path=/` (NOT HttpOnly).
  - Production names prefixed `__Host-`.
- CSRF token compare uses `crypto.timingSafeEqual`.
- Login uses a fixed-shape error response; no oracle for email existence.
- Audit rows MUST log: outcome (`success`/`failure`), reason (`bad_credentials`/`rate_limited`), userId only if known, never the attempted password.
- Logger redaction (SPEC-0006) already strips `password`, `passwordHash`, cookies — verify this is intact and add new keys to `REDACT_PATHS` if you introduce any.
- Session rows must be revocable by deletion — never soft-delete sessions.

## 7. Deliverables

When TASKS-0010 is green, write `ai/reviews/0010-authentication-and-sessions-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test runner output for `auth.test.ts`.
   - `curl -i` output of login and `/me` (with the cookie values truncated for the review file but the `Set-Cookie` attributes visible).
   - Byte-equality check of the two failure responses.
   - Audit log query output showing the three event types.
4. **Security review** — confirm each item in §6 verbatim.
5. **Constant-time analysis** — explain how unknown-email and bad-password paths are kept indistinguishable; include the timing sample (mean + stddev) if you measured.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., memory-based rate limiter resets on restart; argon2 native module ABI risks; CSRF cookie readability for the SPA.
8. **Suggested follow-ups** — Redis-backed sessions / rate limit; password-reset flow; 2FA.
9. **Sign-off checklist** — SPEC-0010 AC-1…AC-8 ✅/❌.

## 8. Communication style

Concise chat; full audit in the review file.

## 9. Exit condition

- All TASKS-0010 boxes ticked.
- Auth tests + manual curl smoke green.
- Review file complete.

Begin.
