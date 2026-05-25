# ADR-0004 — Auth and session strategy

- Status: Proposed
- Date: 2026-05-07
- Deciders: project owner (via AI collaboration)
- Related: [CLAUDE.md](../../CLAUDE.md), [security.md](../context/security.md), [ADR-0002](./ADR-0002-stack-inicial.md), [ADR-0003](./ADR-0003-web-api-sri-core-boundaries.md)

## Context

The Web app is a multi-tenant SaaS behind a login. A single user can belong to multiple companies ([architecture.md](../context/architecture.md)). Every authenticated call must resolve the caller's active tenant and every business query must filter by it ([security.md](../context/security.md)).

Hard constraints (from [CLAUDE.md](../../CLAUDE.md) and [security.md](../context/security.md)):

- Session cookies must be `httpOnly` and `Secure` unless an ADR says otherwise.
- Auth errors must not leak whether a user exists.
- Passwords hashed (argon2id / bcrypt-class).
- Roles/permissions are per tenant.
- Every authenticated endpoint must enforce tenant ownership.
- The platform handles fiscal documents and certificates: a stolen session is high-impact, so revocation must be both possible and immediate.

This ADR only covers authentication between **Web and API**. Service-to-service authentication between **API and SRI-Core** is already decided in [ADR-0003](./ADR-0003-web-api-sri-core-boundaries.md) (signed JWTs per request, not covered here). Public SRI-Core API authentication for third-party integrators is a future ADR.

Deployment assumption: `apps/web` and `apps/api` are independently deployable but expected to share a registrable domain in production via reverse proxy (e.g. `app.example.com` for Web, `api.example.com` for API), so cookies scoped to `.example.com` work without `SameSite=None`. If that assumption breaks, the CSRF and cookie-domain decisions below must be revisited.

## Options considered

The four candidate designs:

1. **Stateless JWT only.** Login issues a single signed JWT with user/tenant claims. Client stores it (header or cookie) and sends it with every request. No server-side state, no refresh.
2. **JWT access token + refresh token.** Login issues a short-lived JWT (access) and a long-lived refresh token. Access token authenticates each request; refresh token obtains new access tokens against a stateful refresh endpoint.
3. **Server-side sessions with opaque session id.** Login issues a random opaque id stored in an `httpOnly; Secure` cookie. Session state (`user_id`, `active_company_id`, `expires_at`, `revoked_at`, …) lives in Postgres / Redis. Each request looks the id up.
4. **Signed `httpOnly` cookie session.** Session payload (user id, tenant id, claims) is serialized into the cookie itself, signed (and ideally encrypted) by the server. No DB row per session. The cookie is the session.

Each option is scored across the dimensions the project cares about.

### 1. Stateless JWT only

- **Security:** Low. A stolen token grants full access until expiry. Long-lived JWTs are common because re-login is annoying without a refresh path, which makes theft worse. Signing-key compromise invalidates everyone at once.
- **Revocation:** Effectively none. Logout is client-side. Any "revoke" feature requires a server-side deny-list, which silently reintroduces state and defeats the model's only real advantage.
- **Scalability:** Best. Verification is a signature check; no store hit on the hot path.
- **Web/API separation:** Works across origins (token in `Authorization` header). No cookie-domain coupling.
- **CSRF:** Low risk **if** the token lives in `localStorage` / memory and travels via `Authorization` header — cookies aren't auto-sent. Risk returns if the token lives in a cookie.
- **XSS:** Worst case. Tokens in `localStorage` / `sessionStorage` are readable by any script that lands on the page; XSS = full account takeover, no mitigation.
- **Operational complexity:** Lowest. One signing key, one verifier.
- **Testing:** Easiest. Sign/verify is local and deterministic.
- **Multi-tenant future:** Poor. Active tenant becomes a JWT claim that cannot be mutated server-side. Tenant switch requires re-issuing the token; stale tokens in parallel tabs reflect the old tenant. Role/permission changes don't take effect until expiry.

### 2. JWT access token + refresh token

- **Security:** Medium. Short-lived access tokens (5–15 min) limit the blast radius of theft. Refresh tokens must be tightly bound (rotation, reuse detection, device binding) or they regress to option 1 with extra steps.
- **Revocation:** Partial. Refresh tokens are revocable (server-side store). Access tokens are not, unless a deny-list is added. Practical revocation latency = remaining access-token TTL.
- **Scalability:** Good. Access-token verification is stateless. Refresh endpoint is stateful but low-traffic.
- **Web/API separation:** Works fine; access token in header, refresh token typically in `httpOnly` cookie scoped to the refresh path.
- **CSRF:** Medium. Refresh endpoint that reads a cookie needs CSRF protection. State-changing requests via header-borne access tokens do not.
- **XSS:** Same trade-off as option 1 for the access token. Storing it in memory (not `localStorage`) helps but complicates page reloads. Refresh token in `httpOnly` cookie is safe from JS read but vulnerable to forced-refresh attacks if CSRF is missing.
- **Operational complexity:** High. Refresh rotation, reuse detection, signing-key rotation, JWKS publishing, two cookie/header policies, deny-list for emergencies. Lots of moving parts for a single Web client.
- **Testing:** Complex. Lifecycle tests, refresh races, clock-skew tolerance, reuse-detection paths, deny-list integration.
- **Multi-tenant future:** Mediocre. Tenant claim in the access token goes stale on tenant switch. Either accept a 5–15 min lag or force a refresh (which mostly defeats the stateless win). Hostile parallel-tab UX.

### 3. Server-side sessions with opaque session id

- **Security:** High. Cookie is `httpOnly; Secure; SameSite=Lax` — unreadable by JS. The id is opaque random, leaks no information. All authoritative state stays server-side.
- **Revocation:** Instant. Delete the row (logout) or set `revoked_at` (admin "log out all sessions"). Checked on every request — the cost of one indexed lookup is acceptable for a fiscal-document app.
- **Scalability:** Good with a small caveat. Every authenticated request hits the session table. At expected scale this is trivial; if it ever isn't, a Redis or in-memory cache with short TTL is a drop-in.
- **Web/API separation:** Best when Web and API share a registrable domain (cookie scoped to the parent domain). Cross-domain deployment requires `SameSite=None; Secure` plus tight CORS, which is workable but reduces CSRF defense-in-depth. Matches our deployment assumption.
- **CSRF:** Cookies are auto-sent, so CSRF protection is required. `SameSite=Lax` blocks most cross-site `POST`s by default; an explicit CSRF token on state-changing methods covers the residual surface. Well-understood pattern.
- **XSS:** Best. `httpOnly` removes the cookie from JS reach. XSS can still ride the session by issuing same-origin requests, but cannot exfiltrate the credential.
- **Operational complexity:** Medium. Session table, CSRF middleware, cookie config. All of this is library-supported and well-trodden ground in NestJS.
- **Testing:** Straightforward. Session rows are easy to set up in integration tests; CSRF middleware can be exercised directly.
- **Multi-tenant future:** Best. Active tenant is a column on the session row. Tenant switch is a single `UPDATE`. Permission changes apply on the next request. Parallel tabs see consistent state because they all read from the same row.

### 4. Signed `httpOnly` cookie session

- **Security:** Medium. `httpOnly; Secure` cookie protects from JS read. Signing prevents tampering; encryption (recommended) prevents disclosure. But the entire session is in the client's hands — if the signing/encryption key leaks, every session is compromised at once.
- **Revocation:** Poor, same as option 1. Without server-side state there is no row to delete. Adding a deny-list reintroduces state and gives back option 3 with worse ergonomics. Forcing a key rotation revokes everyone, which is not a per-user tool.
- **Scalability:** Excellent — no store hit. But cookies are sent on every request, so a fat session payload taxes bandwidth and bumps into the 4 KB cookie limit fast (especially with role/permission expansion).
- **Web/API separation:** Same as option 3 — depends on shared registrable domain.
- **CSRF:** Same as option 3 — cookies auto-sent, CSRF token required.
- **XSS:** Same as option 3 — `httpOnly` protects the cookie value from JS.
- **Operational complexity:** Low-medium. No store, but a signing-key (and ideally encryption-key) lifecycle: generation, rotation, multi-key verification window. Cookie size is a constant balancing act.
- **Testing:** Easy in isolation. Harder to assert "user X is logged out" because there's no server state to inspect — tests have to manipulate cookies and clock.
- **Multi-tenant future:** Poor. Tenant switch requires re-issuing the cookie; parallel tabs hold stale cookies until they make a request that overwrites them. Permission changes don't propagate until next mint.

### Comparison matrix

Legend: ✅ strong, ➖ acceptable, ❌ weak.

| Dimension              | 1. Stateless JWT  | 2. JWT access + refresh | 3. Server-side session     | 4. Signed cookie session   |
| ---------------------- | ----------------- | ----------------------- | -------------------------- | -------------------------- |
| Security               | ❌                | ➖                      | ✅                         | ➖                         |
| Revocation             | ❌                | ➖ (TTL-limited)        | ✅ instant                 | ❌                         |
| Scalability            | ✅                | ✅                      | ➖ (cache fixes it)        | ✅                         |
| Web/API separation     | ✅                | ✅                      | ➖ (best on shared domain) | ➖ (best on shared domain) |
| CSRF                   | ✅ (header-borne) | ➖                      | ➖ (token required)        | ➖ (token required)        |
| XSS                    | ❌                | ❌ for access token     | ✅                         | ✅                         |
| Operational complexity | ✅                | ❌                      | ➖                         | ➖                         |
| Testing                | ✅                | ❌                      | ✅                         | ➖                         |
| Multi-tenant future    | ❌                | ➖                      | ✅                         | ❌                         |

### Tangential decisions folded into this ADR

- **Password hashing:** argon2id is the current consensus best; bcrypt is acceptable as a fallback if a vetted argon2id binding is problematic on Node 24.
- **Tenant switching:** since a user can belong to multiple companies, the "active tenant" is part of session state, not part of the user row. Switching tenants mutates the session, not the identity.
- **CSRF mechanism:** because cookies are auto-sent, a session-cookie design needs CSRF defense regardless of which option is picked among 3 and 4. `SameSite=Lax` is the baseline; an explicit CSRF token on state-changing methods is layered on top.

## Recommendation

**Pick option 3 — server-side sessions with an opaque session id.**

Reasoning, in plain terms:

- **Revocation is non-negotiable here.** This platform issues fiscal documents and stores signing certificates. A compromised session must be killable now, not in 5–15 minutes. Only option 3 gives us instant, per-user revocation without bolting state onto a stateless design.
- **Multi-tenant is a first-class concern.** Users belong to multiple companies and switch between them; roles are per tenant. Active tenant must be a server-mutated value, not a stale claim trapped in a token. Option 3 makes this trivial; options 1, 2, and 4 all fight us.
- **XSS hardening is meaningful.** `httpOnly` cookies remove the most common token-theft vector. Options 3 and 4 both win here; options 1 and 2 in their typical deployments do not.
- **We don't need the scalability that stateless designs trade for.** A single indexed lookup per request is well within budget. If we ever measure pressure, a session cache is a small follow-up.
- **One Web client, one mental model.** We have exactly one consumer of this auth surface. Adding refresh-token machinery (option 2) or self-contained-cookie subtleties (option 4) buys us complexity we cannot justify. If a public SRI-Core integrator surface or native mobile app appears, it gets a separate, token-based path — explicitly out of scope for this ADR.

The cost we accept: every authenticated request hits the session table, and we maintain a small CSRF mechanism. Both are well within budget for a NestJS API on Postgres.

## Decision

1. **Model: server-side sessions with a `httpOnly; Secure; SameSite=Lax` cookie.** The cookie carries an opaque session id (ULID). Session state lives in Postgres (same DB as the API) with columns at least: `id`, `user_id`, `active_company_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `user_agent`, `ip_hash`. No JWTs for Web↔API auth.
2. **Session lifetime:** rolling 30-day expiration, refreshed on every authenticated request up to a hard cap of 90 days since issue. Idle sessions beyond 30 days are expired server-side.
3. **Revocation:** logging out deletes the session row. An admin "revoke all sessions for user" action sets `revoked_at` on every session. Revocation is checked on every request — the cheap DB lookup is worth it.
4. **Password storage:** **argon2id** with conservative parameters (to be tuned per environment). Fallback to bcrypt only if argon2id cannot be used; documented if it happens.
5. **Login error shape:** one response, one timing. "Invalid credentials" for both "unknown email" and "wrong password". Enforce a minimum response time or use the hashing step itself as the timing floor.
6. **Tenant in session.** Active `company_id` is part of the session row. Switching tenants is `POST /api/v1/session/tenant { companyId }` — server validates membership and mutates the session row. Web re-renders from the new tenant context.
7. **Tenant enforcement.** Every authenticated request at the API layer runs through a guard that (a) loads the session, (b) resolves the active tenant, (c) attaches both to the request context. Handlers never read `companyId` from the request body. Missing this guard is a security bug.
8. **CSRF.** API requires a CSRF token header on all state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) when authenticated via cookie. Token is issued at login, rotated on tenant switch and on role change. Same-origin deployment may drop the token if an ADR revisits this.
9. **Transport.** Cookies are issued with `Secure`; HTTPS-only is mandatory in all environments except local dev on `http://localhost`, which uses `__Host-` prefix + `Secure: false` only when `NODE_ENV !== 'production'`. Production must refuse to boot without HTTPS.
10. **Framework choice.** Session primitives (cookie parsing, CSRF, argon2id) are wired into the NestJS stack with small focused libraries rather than adopting a full auth framework. Auth.js / Lucia are re-evaluated if a second client (mobile, public SRI-Core integrator portal) appears.
11. **Public SRI-Core API (future).** Integrators authenticate with **API keys issued per tenant**, exchanged for short-lived signed JWTs by SRI-Core's token endpoint. This is out of scope for this ADR beyond noting that the Web session model above does **not** apply to that surface.

## Consequences

Positive:

- Revocation is instant and auditable, which matters because compromised sessions for a fiscal-document system are high-impact.
- No tokens in JavaScript means XSS cannot exfiltrate the session directly.
- Tenant switching is a first-class, server-validated operation rather than an afterthought bolted onto a JWT claim.
- One simple mental model ("cookie + DB row") across the whole Web↔API surface. Easier to reason about during security review.

Negative / trade-offs:

- Every authenticated request hits the session table. Acceptable at our scale; a cache (Redis or in-memory with short TTL) is an easy follow-up if it matters.
- Sessions couple Web scaling to Postgres availability. Same constraint applies to the rest of the API, so no net new operational risk.
- CSRF tokens add one more concept to the Web client and one more middleware on the API. Worth the protection given state-changing fiscal operations.
- If we later need a native mobile client, we will add a **separate** token-based path (likely OAuth2-style) without touching this one. Documented trade-off.
- Cross-registrable-domain Web/API deployment would force `SameSite=None` and weaken CSRF defense-in-depth. We accept the constraint of a shared parent domain in production; if that ever changes, this ADR is revisited.

Follow-ups:

- Pick and pin argon2id parameters (ADR or tuning doc) after measuring on the target deploy environment.
- Define the exact session table schema in `apps/api` with migrations.
- Decide whether to add a Redis cache for session lookups (non-blocking; postpone until metrics justify it).
- Specify the CSRF token mechanism (header name, rotation rules, storage on the Web side).
- Write a dedicated ADR for public SRI-Core API key issuance and JWT exchange when that product surfaces.
