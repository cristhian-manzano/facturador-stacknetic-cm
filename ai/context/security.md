# Security context

Background and threat model. The **hard rules** live in [CLAUDE.md](../../CLAUDE.md) ("Security") and [AGENTS.md](../../AGENTS.md) — this file explains the reasoning and names the assets worth protecting.

## Crown jewels

Ordered by blast radius if leaked.

1. **Tenant signing certificates and private keys** (`.p12` / `.pfx`). A leak lets an attacker sign fiscal documents on behalf of a real company. These live **only** inside SRI Core and must never transit to Web or API, never be logged, never be included in error responses, never be checked into git.
2. **SRI authorization credentials / session tokens** obtained when talking to SRI web services.
3. **Personally identifiable tax data**: RUCs, cédulas, customer lists, issued invoices. Leak = regulatory exposure.
4. **User passwords and sessions**.
5. **Database credentials, SMTP, third-party API keys**.

## Trust zones

```text
Public internet ─▶ apps/web ─▶ apps/api ─▶ apps/sri-core ─▶ SRI
     untrusted    semi-trusted  trusted      high-trust     external
```

- Validate every external input at the `apps/api` boundary. Never trust `apps/web` to have done it.
- `apps/sri-core` is the only zone allowed to hold certificates and private keys. It must reject requests it cannot authenticate as coming from `apps/api`.
- SRI web services are external: treat responses as untrusted (timeouts, malformed XML, unexpected error shapes) and normalize before returning.

## Certificate handling (SRI Core)

- Private keys: encrypted at rest, decrypted only in memory at signing time.
- Never log the certificate, its password, the decrypted key, or the signed-but-unauthorized XML body in full.
- Certificates have expiration dates — surface this to the tenant well before expiration. Do not silently fail emissions because a certificate expired.
- Each tenant has its own certificate. Never fall back to another tenant's certificate.

## Authentication and authorization

- Passwords: always hashed (argon2id / bcrypt-class). Never plaintext, never reversible.
- Auth errors must not reveal whether an email exists (same response and timing for "unknown user" and "bad password").
- Session cookies: `httpOnly`, `Secure`, `SameSite=Lax` (or stricter). Any exception requires an ADR.
- Every authenticated endpoint must resolve the caller's tenant and enforce that the requested resource belongs to it. A correct user on the wrong tenant is forbidden.
- Roles/permissions are per tenant, not global.

## Multi-tenant isolation

- Every query that reads business data must filter by `companyId` (or equivalent). Missing this filter is a security bug, not a performance bug.
- Document sequences are per `establecimiento`/`punto de emisión`/`company`. A gap or a reuse across tenants is fraud-equivalent.
- Audit log tenant actions that touch certificates, sequences, or SRI submissions.

## Input validation

- Validate at API boundaries with explicit schemas (numeric ranges, RUC format, date bounds, enum values).
- For SRI-bound payloads, validate against the business rules **and** against the canonical XSDs inside SRI Core. A payload that passes business validation but fails XSD should be caught before the SRI round trip.

## Logging and telemetry

Do not log:

- Request/response bodies that contain customer PII, invoice line items, or signed XML.
- Authorization tokens, cookies, headers with credentials.
- Private keys, certificate bytes, certificate passwords.
- SRI credentials.

Do log:

- Correlation IDs, tenant IDs, document IDs, SRI state transitions, error codes (not error bodies when they embed PII).

## CI / supply chain

- Dependencies require justification (see CLAUDE.md). Each new dep is an extra attacker surface.
- Do not commit `.env` files, certificates, fixtures with real RUCs or real customer data.
- Test fixtures under `apps/sri-core/test/fixtures/` must use synthetic RUCs (SRI publishes reserved test RUCs).

## Common pitfalls to watch for

- Leaking the full SRI XML (with customer data and signature) in error payloads or logs.
- Returning distinct error messages for "user not found" vs "wrong password".
- Accepting a `companyId` from the client request body instead of deriving it from the authenticated session.
- Decoding a certificate at API boundary layer to "check validity" — that belongs in SRI Core.
- Using a single deployment-wide signing key "for now".
