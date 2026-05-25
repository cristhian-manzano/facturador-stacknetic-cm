---
name: secure-code-review
description: Mandatory secure-coding and security-review skill for any code work. Apply it whenever the user asks to generate, write, review, refactor, modify, audit, extend, migrate or "improve" code — even briefly — especially when the code touches APIs, endpoints, authentication, authorization, sessions, JWT/OAuth/MFA, user input, databases, queries, file handling, uploads, downloads, serialization, networking, subprocess/command execution, secrets, API keys, environment variables, configuration, dependencies, package manifests (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, composer.json, pom.xml), Dockerfiles, Kubernetes manifests, Terraform, CI/CD pipelines (GitHub Actions, GitLab CI), cookies, headers, CORS, uploads, payments, invoices, PII or any sensitive or personal data. Use this skill proactively even if the user does NOT say the word "security" — if any code is being produced, reviewed or changed, this skill applies. Enforces OWASP Top 10, OWASP ASVS, OWASP API Security Top 10, secure-by-default configuration, least privilege, per-resource authorization, input validation and output encoding, safe dependency selection, strong crypto, proper secrets handling, secure HTTP headers, rate limiting, safe error handling and logging, and supply-chain safety. Produces a structured report: security summary, key findings, risks grouped by severity (low/medium/high/critical), concrete recommendations, corrected/secure code example, and a final validation checklist.
---

# Secure Code Review

A skill that enforces security-by-default whenever code is being generated, reviewed, refactored, modified or audited. It does not replace a full penetration test — it is a fast, practical, defense-in-depth pass applied to every change so that common vulnerabilities are caught before they ship.

## When to use this skill

Use it whenever any of these is true:

- The user asks to write, generate, scaffold, refactor, modify, extend, migrate, "fix", "clean up", "improve" or audit code.
- The change touches: HTTP handlers, APIs, GraphQL resolvers, RPC, WebSockets, auth flows, session/cookie/token logic, database access, ORMs, raw queries, file I/O, uploads/downloads, networking, subprocess/command execution, deserialization, template rendering, or client-side storage.
- The change touches: `package.json`, `pnpm-lock.yaml`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, `pom.xml`, `Dockerfile`, `docker-compose.yml`, Kubernetes manifests, Terraform, Helm, `.github/workflows/*`, `.gitlab-ci.yml`, `.env*`, or any secret/config file.
- The domain involves PII, invoices, payments, health data, credentials, or anything a regulator would care about.
- The user is making a decision that could introduce a vulnerability (e.g., "should I store the JWT in localStorage?", "how do I disable CORS?", "how do I make this endpoint public?").

If in doubt, apply it. Undertriggering is worse than overtriggering.

**Exception:** purely cosmetic or non-code tasks (writing prose, renaming a variable with no semantic change, editing a README line) don't need a full pass. A one-line acknowledgement that there is nothing security-relevant is enough.

## Guiding principles

1. **Secure by default.** The default path must be the safe path. If the user has to remember to add a flag, harden a config, or remove a debug toggle to be safe, the default is wrong.
2. **Least privilege.** Every token, role, container, service account, DB user, cookie, CORS origin, and file permission should grant the minimum needed. Widen only with a concrete reason.
3. **Defense in depth.** Assume each layer can fail. Input validation _and_ parameterized queries _and_ output encoding _and_ a WAF is not redundant — it is resilience.
4. **Explain the why.** When flagging a risk or making a recommendation, state the concrete threat (what an attacker does, what they gain). "Because OWASP says so" is not an explanation.
5. **Don't ship known-vulnerable patterns.** If a safer alternative exists and is reasonable, use it. Do not write code that introduces SQLi, XSS, SSRF, command injection, insecure deserialization, path traversal, open redirect, or hardcoded secrets when an equally simple safe form exists.
6. **Pragmatism over paranoia.** Not every app needs HSM-backed keys. Match the controls to the actual threat model and the data's sensitivity, and say so.

## Review workflow

When this skill triggers, run through these steps **in order**:

1. **Understand the context.** What does this code do? Who calls it? What data does it handle? What trust boundary does it cross (public internet → app, app → DB, browser → API, CI → prod)? Name the boundary explicitly — most vulnerabilities live there.
2. **Enumerate the threat surface.** For each input (HTTP params, headers, cookies, body, files, env vars, DB rows, message queues, third-party responses) ask: who controls this, and what happens if it's hostile?
3. **Check against the threat categories** in the next section. Don't just pattern-match keywords — reason about the code.
4. **Evaluate any new or modified dependency** against the dependency rules below. Reject unsafe or abandoned packages.
5. **Produce the output report** in the exact format described in "Output format".
6. **When the user is generating new code, write it secure the first time.** Don't ship an insecure draft and then "review" it — apply the controls up front, and call out the interesting decisions in the summary.

## Threat categories to check

For each category, ask the concrete question in parentheses. If the answer is "I don't know" or "it's not checked", that is a finding.

**Injection & untrusted input**

- SQL / NoSQL / ORM injection (_are all queries parameterized? any string concatenation with user input?_)
- Command / shell injection (_any `exec`, `system`, `subprocess(shell=True)`, `child_process.exec` with user input?_)
- XSS — reflected, stored, DOM (_is every output properly encoded for its sink: HTML body, attribute, JS, URL, CSS?_)
- XXE, XML external entities (_XML parser configured with external entities disabled?_)
- LDAP / template / SSTI / header injection
- Path traversal (_any `../`, symlink following, unvalidated file names joined to a base path?_)
- Insecure deserialization (_`pickle`, `yaml.load`, `unserialize`, `ObjectInputStream` on untrusted data?_)
- Open redirect (_is the redirect target validated against an allow-list?_)

**Auth & session**

- Is authentication required where it should be? Is it enforced server-side (never trust the client)?
- Passwords: hashed with argon2id / bcrypt / scrypt and a proper cost; never stored plaintext, never logged.
- MFA supported for privileged accounts where the domain warrants it.
- Sessions: rotated on login, invalidated on logout and password change, idle + absolute timeouts, secure random IDs.
- Cookies: `Secure`, `HttpOnly`, `SameSite=Lax` or `Strict`, `__Host-` prefix for session cookies where applicable.
- JWTs: algorithm pinned (no `alg: none`, no HS/RS confusion), signature verified, `exp`/`nbf`/`iss`/`aud` validated, short-lived access tokens + rotating refresh tokens with revocation, tokens not in `localStorage` if XSS-reachable.
- OAuth2 / OIDC: PKCE on public clients, state parameter checked, redirect URIs allow-listed, scopes minimal.
- Brute-force / credential-stuffing defenses (throttling, lockout with care not to DoS the user, CAPTCHA or proof-of-work where appropriate).

**Authorization**

- Every resource access checks "is this caller allowed to see/modify _this specific object_" — not just "are they logged in". (This is BOLA / IDOR — the #1 API Top 10 issue.)
- Role / permission checks happen on the server, not the client.
- Mass assignment / over-posting blocked (explicit allow-list of fields the client may set).
- Admin paths require admin auth, not "the UI just doesn't show the button".

**Data protection**

- TLS everywhere in transit; HSTS where applicable.
- Sensitive data encrypted at rest where the threat model warrants it.
- Secrets (API keys, DB creds, signing keys): in a secret manager or env vars injected at runtime — never committed, never logged, never in client code.
- PII minimization: only collect what's needed, retain for the minimum time, redact in logs.
- Strong, vetted crypto primitives only (AES-GCM, ChaCha20-Poly1305, Ed25519, X25519, SHA-256/384, HKDF, argon2id). No MD5/SHA-1 for security, no ECB, no homemade crypto, no hardcoded IVs.

**Request abuse & availability**

- Rate limiting / throttling / quotas on auth endpoints, expensive endpoints, and write endpoints.
- Progressive backoff or lockout on repeated failures (without enabling attacker-triggered DoS of legitimate users).
- Resource limits: max request size, max JSON depth, max file size, timeouts on every outbound call.
- SSRF: outbound requests from the server validate the target host against an allow-list and block link-local, loopback, metadata IPs (169.254.169.254, etc.).
- Race conditions on financial / invoice / inventory operations: use transactions, row locks or optimistic concurrency, not "read-then-write".
- Replay protection on sensitive operations (nonces, idempotency keys).

**Client & transport hardening**

- Security headers where applicable: `Content-Security-Policy` (no `unsafe-inline` / `unsafe-eval` unless justified), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` or CSP `frame-ancestors`.
- CORS: explicit allow-list of origins, never `*` with credentials, methods and headers minimized.
- Client storage: no tokens or PII in `localStorage`/`sessionStorage` if XSS is in scope; prefer HttpOnly cookies.
- Clickjacking defense via `frame-ancestors`.

**Error handling & logging**

- Errors returned to the user are generic; internals (stack traces, SQL, file paths) stay server-side.
- Logs record security-relevant events (auth success/failure, privilege change, admin action) but never log secrets, passwords, tokens, full card numbers, or full PII.
- Log forging / log injection: untrusted input is encoded before being logged.

**Configuration & infra**

- Debug / verbose modes off in production.
- Default admin credentials removed.
- DB users scoped to just what they need (no app running as DB superuser).
- Containers: non-root user, no `--privileged`, minimal base image, `readOnlyRootFilesystem` where possible.
- Kubernetes: `securityContext`, `NetworkPolicy`, resource limits, no cluster-admin service accounts for app workloads.
- CI/CD: no long-lived privileged tokens, OIDC / short-lived creds preferred, secrets in the CI secret store not in `env:` blocks, pinned action versions (SHA, not `@main`), scanned for leaked secrets, SCA + SAST in the pipeline where feasible.

See `references/owasp-checklist.md` for an expanded checklist, `references/api-security.md` for auth/token/API specifics, and `references/dependencies.md` for dependency evaluation guidance.

## Dependency rules

New or upgraded dependencies are a supply-chain risk. Apply these rules every time a package is added, bumped, or replaced.

1. **Do you actually need it?** If the language's standard library or an already-present dependency covers the need with reasonable effort, prefer that. "Reasonable" means "not reimplementing crypto / parsing a format by hand / writing hundreds of lines of fiddly code". Small wrappers around built-ins are not worth a dependency.
2. **Evaluate the candidate.** Before recommending, check:
   - **Popularity / adoption:** high download count, widely used in the ecosystem. A brand-new package with 12 downloads is a red flag.
   - **Maintenance:** last release within roughly the last 12 months, or an intentionally-stable mature project with recent security responses. Inactive for years with open security issues → reject.
   - **Reputation:** reputable author/org, reasonable star count for its niche, issues not piling up unaddressed, no history of hostile takeovers or typosquatting. Check the exact package name character-for-character (typosquats like `lodahs`, `colors-js`, `reqeust` are a known attack vector).
   - **Security posture:** no unpatched CVEs of high/critical severity, minimal transitive dependency tree, no unnecessary native / postinstall scripts, license compatible with the project.
3. **Pin and lock.** Use the lockfile; pin versions. For CI actions, pin to a commit SHA rather than a mutable tag.
4. **Propose an alternative if the candidate fails.** Don't just say "this package is unsafe" — name a maintained alternative, or show how the standard library covers the need.
5. **Remove unused dependencies.** If a review reveals a package is no longer used, call it out.

## Severity scale

Use these labels consistently. The user will act on severity, so be honest — don't inflate, don't downplay.

- **Critical** — Remote unauthenticated compromise, full data exfiltration, RCE, auth bypass on privileged paths, secret leak with active blast radius. Fix before merge.
- **High** — Authenticated exploitation leading to significant data loss, privilege escalation, stored XSS, IDOR on sensitive records, weak crypto on production data, missing auth on a write endpoint. Fix before release.
- **Medium** — Meaningful risk requiring specific conditions: missing rate limiting on auth, weak password policy, verbose error disclosure, missing security headers, CSRF on state-changing endpoints with SameSite partially mitigating. Plan a fix.
- **Low** — Hardening opportunities and defense-in-depth gaps with small real-world impact: missing `Referrer-Policy`, overly permissive but non-credentialed CORS, log verbosity, outdated-but-not-vulnerable dependency. Fix when convenient.

When a risk is found, always state: **what the issue is**, **severity**, **concrete impact** (what an attacker actually does and gains), **mitigation**, and the **corrected code** when the fix is local.

## Output format

When this skill triggers on a review or audit, produce the report in this exact structure. Omit a section only if it is truly empty (e.g., no corrected code needed because there were no code-level findings).

```markdown
## Security summary

<2–4 sentences: what was reviewed, what trust boundary it crosses, and the overall posture.>

## Key findings

<Bulleted list of the most important issues and the most important things done right. Keep it scannable.>

## Risks by severity

### Critical

- **<title>** — <impact>. Mitigation: <fix>.

### High

- ...

### Medium

- ...

### Low

- ...

## Recommendations

<Concrete, actionable steps, ordered by priority. Include dependency changes, config changes, and design changes.>

## Corrected / secure code

<Diffs or full snippets for the code-level fixes. Only include what actually changed or what the user asked to generate. Explain non-obvious choices in 1–2 lines.>

## Validation checklist

- [ ] Inputs validated and outputs encoded for their sink
- [ ] AuthN enforced server-side where required
- [ ] AuthZ enforced per-resource (no IDOR / BOLA)
- [ ] Secrets out of source, out of logs, out of client bundles
- [ ] Parameterized queries / safe deserialization / no shell injection
- [ ] Transport hardened (TLS, HSTS) and security headers set
- [ ] CORS, cookies, client storage configured safely
- [ ] Rate limiting / quotas on sensitive endpoints
- [ ] Error messages generic; logs redact sensitive data
- [ ] Dependencies reviewed (need, popularity, maintenance, reputation, CVEs, license)
- [ ] CI/CD, containers and infra follow least-privilege
- [ ] Threat model and trust boundary documented for this change
```

If the user is _generating_ code (not reviewing existing code), compress the report: write the secure code first, then a short "Security notes" section explaining the key decisions and the checklist at the end.

## When there's nothing to flag

Say so. A clean report with the checklist passed is useful — it tells the user you actually looked. Don't invent findings to justify the skill's existence.

## Interaction with the user

- If you lack context to make a judgment (e.g., "is this endpoint public or behind VPN?"), ask one focused question rather than speculate, or flag both cases explicitly in the report.
- Prefer one strong, well-justified recommendation over a list of five mediocre ones.
- If the user explicitly pushes back on a recommendation ("we accept this risk"), record that acceptance in the summary rather than silently removing the finding.

## Reference files

- `references/owasp-checklist.md` — Expanded OWASP Top 10, ASVS mapping, and per-category deep-dives.
- `references/api-security.md` — API Security Top 10, JWT/OAuth/session specifics, rate limiting patterns.
- `references/dependencies.md` — Dependency evaluation rubric and common pitfalls.
