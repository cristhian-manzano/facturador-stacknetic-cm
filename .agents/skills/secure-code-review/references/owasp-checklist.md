# OWASP checklist — expanded

Deep-dive companion to `SKILL.md`. Load this when the review needs more than the summary in the main skill file.

## OWASP Top 10 (web, 2021 edition, still the working reference)

### A01: Broken Access Control
The single most common category. Every resource access must answer: *is this caller allowed to read/write this specific object, right now, under their current role?*

- Enforce server-side; never rely on the UI hiding a button.
- Deny by default. Each route/resource must opt in to who can use it.
- Reject direct object references without an ownership/permissions check (IDOR).
- Prevent path traversal on file access.
- Prevent mass assignment / over-posting — whitelist fields the client may set.
- CORS must not be used as an access control (it's a browser-enforced convention, not auth).
- Disable unused HTTP methods; rate-limit API endpoints.
- Log failed access decisions; alert on patterns.

### A02: Cryptographic Failures
- TLS for everything non-trivial. HSTS on web responses. No mixed content.
- Don't use MD5 or SHA-1 for anything security-relevant. Don't hand-roll crypto.
- Passwords: argon2id (preferred) or bcrypt with a modern cost. Never SHA-256(password). Never "encrypted" passwords — always hashed.
- Symmetric encryption: AES-GCM or ChaCha20-Poly1305 with unique nonces. No ECB. No static IVs.
- Asymmetric: Ed25519/X25519 or RSA-OAEP/RSA-PSS with ≥2048-bit keys (3072+ preferred).
- Derive keys via HKDF or argon2id, not by hashing a password directly.
- Don't store sensitive data you don't need. Redact in logs.

### A03: Injection
- SQL: parameterized queries, prepared statements, ORMs used correctly (no `.raw()` with concatenation).
- NoSQL: treat user-supplied objects carefully; avoid passing raw user input as query shape (e.g., Mongo `$where`, `{ $gt: '' }` tricks in auth).
- Command injection: prefer native APIs to shelling out. If you must, use `execFile`/`spawn` with an argv array; never `shell: true` with interpolation.
- LDAP: escape DN and filter metacharacters.
- Template injection (SSTI): never feed user input into a template engine as the template itself.
- Header injection: strip `\r\n` from values used in headers/emails.
- XXE: disable external entity resolution (`defusedxml` in Python, `setFeature` in Java parsers).

### A04: Insecure Design
- Threat-model the feature. For each actor, what's the worst they can do if they misbehave?
- Rate-limit and quota sensitive flows (auth, signup, password reset, invoice create, export).
- Separate trust zones — a public endpoint should not share code paths with an admin-only one without explicit auth gates.

### A05: Security Misconfiguration
- No default credentials, no sample apps, no directory listings, no verbose errors in prod.
- Security headers (`CSP`, `HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` / `frame-ancestors`).
- Disable methods you don't use (TRACE, OPTIONS where not needed by CORS).
- Review cloud storage bucket policies for public exposure.

### A06: Vulnerable and Outdated Components
- Keep an up-to-date SBOM. Scan with SCA tooling in CI.
- Subscribe to advisories for the critical deps.
- Remove unused dependencies.

### A07: Identification and Authentication Failures
- See `api-security.md` for the depth on JWT/OAuth/MFA/session. Highlights:
  - Rate-limit login and password reset.
  - Generic error messages — don't reveal whether an email is registered.
  - Rotate session IDs on privilege change and login.
  - Invalidate on logout and password change.

### A08: Software and Data Integrity Failures
- Verify signatures on downloaded binaries and updates.
- Do not deserialize untrusted data with `pickle`, `yaml.load`, `unserialize`, `ObjectInputStream`.
- CI/CD: pin action SHAs, isolate secrets, require reviews for workflow changes.

### A09: Security Logging and Monitoring Failures
- Log auth events, admin actions, privilege changes, and access denials.
- Redact secrets, tokens, full PII. Use structured logs to make redaction enforceable.
- Alert on anomalies (spike in 401s, many failed logins, unusual admin activity).

### A10: Server-Side Request Forgery (SSRF)
- Validate outbound URLs against an allow-list.
- Block link-local, loopback, and cloud metadata IPs (169.254.169.254, fd00::/8, 127.0.0.0/8, 10.0.0.0/8 etc. unless explicitly needed).
- Resolve DNS once, connect to the resolved IP, to prevent DNS-rebinding.
- Disable HTTP redirects following into internal hosts.

## ASVS quick mapping

OWASP ASVS is the "what good looks like" checklist. Use level 1 as a minimum, level 2 as the default for apps handling user data, and level 3 for high-assurance systems (payments, health, critical infra).

Chapters most often relevant to code review:
- V1 Architecture, threat modeling
- V2 Authentication
- V3 Session management
- V4 Access control
- V5 Validation, sanitization, encoding
- V6 Stored cryptography
- V7 Error handling and logging
- V8 Data protection
- V9 Communication (TLS)
- V10 Malicious code
- V11 Business logic
- V12 Files and resources
- V13 API and web service
- V14 Configuration

If you find yourself unsure what the "right" bar is, check the corresponding ASVS section.
