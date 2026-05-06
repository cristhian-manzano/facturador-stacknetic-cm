# API security — JWT, OAuth, sessions, MFA, rate limiting

Use this file when the review touches authentication, authorization, tokens, or API endpoints.

## OWASP API Security Top 10 (2023)

1. **Broken Object Level Authorization (BOLA)** — Every endpoint that accepts an object ID must verify the caller owns or is allowed to access that specific object. Most common API flaw.
2. **Broken Authentication** — Weak login, weak token verification, no rate limiting on auth, predictable tokens, long-lived credentials.
3. **Broken Object Property Level Authorization** — Mass assignment and excessive data exposure. Don't let clients set arbitrary fields. Don't return objects with internal fields the client didn't ask for.
4. **Unrestricted Resource Consumption** — No rate limits, no pagination caps, no request size limits. Expensive endpoints (exports, reports) especially vulnerable.
5. **Broken Function Level Authorization** — Admin routes reachable with regular tokens; `/admin/users` not gated.
6. **Unrestricted Access to Sensitive Business Flows** — Signup, purchase, referral abuse. Requires business-logic-aware rate limiting (per user, per IP, per payment method).
7. **SSRF** — See the main OWASP file.
8. **Security Misconfiguration** — Permissive CORS, missing security headers, verbose errors.
9. **Improper Inventory Management** — Old API versions still live, staging endpoints exposed to prod traffic, undocumented endpoints.
10. **Unsafe Consumption of APIs** — Trusting data from third-party APIs without validation; following redirects into internal networks.

## Sessions

- Session IDs: ≥128 bits of entropy, from a CSPRNG.
- Rotate on login, on privilege change, on detection of suspicious activity.
- Absolute timeout (e.g., 12–24h) + idle timeout (e.g., 15–30 min for sensitive apps).
- Invalidate server-side on logout — clearing the cookie is not enough if the session ID still works.
- Cookie attributes: `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict` for admin), `__Host-` prefix when possible, narrow `Path`.

## JWT

JWT is not a session. It's a stateless credential. Treat it accordingly.

- **Pin the algorithm.** Verify with a specific algorithm, never "whatever `alg` says". Reject `alg: none`. Avoid HS256 + RS256 confusion by never accepting both for the same endpoint.
- **Verify the signature** before reading any claim. Never parse claims from an unverified JWT.
- **Validate claims:** `exp`, `nbf`, `iat`, `iss`, `aud`. Reject if missing.
- **Short-lived access tokens** (5–15 min). Pair with a rotating refresh token that can be revoked.
- **Storage in the browser:**
  - `HttpOnly` secure cookie: protected from JS (XSS can still make authenticated requests via the cookie, so CSRF protection is still required — SameSite + anti-CSRF token for state-changing endpoints).
  - `localStorage`: exposed to any XSS; suitable only if XSS is strongly mitigated (strict CSP, trusted-types) and the token is low-value.
- **Revocation:** JWTs can't be "logged out" unless you track a revocation list or keep token IDs in a DB. Plan for this from day one on sensitive apps.
- **Don't put PII or secrets in the JWT body.** It's base64, not encrypted.

## OAuth2 / OIDC

- **Authorization Code + PKCE** for public clients (SPAs, mobile, CLIs). Never Implicit.
- Validate the `state` parameter on callback.
- Allow-list redirect URIs — exact match, no wildcards, no "starts with".
- Scope to the minimum needed.
- Verify ID token signatures against the issuer's JWKS; validate `iss`, `aud`, `exp`, `nonce`.
- Protect the token endpoint with rate limiting.

## MFA

- Offer TOTP (RFC 6238) or WebAuthn; SMS is last-resort.
- Require MFA for privileged accounts (admins, billing, export) when the data warrants it.
- Rate-limit the MFA verification endpoint — otherwise brute-forcing a 6-digit code is trivial.
- Recovery codes: single-use, hashed at rest.

## Rate limiting

- Apply at multiple granularities: per IP, per user, per endpoint, per flow.
- Sensitive endpoints to rate-limit: login, signup, password reset, MFA verify, token refresh, export, expensive searches, payment create, invoice generate.
- Use a token bucket or leaky bucket with sensible bursts.
- Progressive backoff on repeated failures. Care not to enable attacker-triggered lockouts (e.g., allow login from a known device even during a lockout).
- Return `429` with `Retry-After` so legitimate clients can back off cleanly.

## CSRF

- For cookie-based auth: `SameSite=Lax` mitigates most cross-site form posts, but state-changing endpoints should still require an anti-CSRF token or a custom header + CORS policy that requires a preflight.
- For `Bearer` token in `Authorization` header: not vulnerable to classic CSRF (the browser doesn't attach it automatically), but you still need to prevent the token from leaking into a site that would forward it.

## Client storage

- **Don't** store access tokens, refresh tokens, or PII in `localStorage` or `sessionStorage` if XSS is in the threat model — which it usually is.
- **Prefer** HttpOnly cookies for session/auth, with SameSite and anti-CSRF for state-changing requests.
- IndexedDB has the same XSS exposure as localStorage.
