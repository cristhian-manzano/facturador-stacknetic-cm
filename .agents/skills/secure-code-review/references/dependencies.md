# Dependency evaluation

Supply-chain attacks are now a primary delivery vector for production incidents (npm `event-stream`, `colors`, `ua-parser-js`, PyPI typosquats, the XZ backdoor). Treat every new dependency as risk surface.

## The rubric

Before adding or upgrading a dependency, answer each of these — briefly — in the review report.

### 1. Is it necessary?

- Does the standard library cover it? (e.g., `crypto`, `url`, `fetch` in modern Node; `hashlib`, `urllib.parse`, `zoneinfo` in modern Python.)
- Does an existing dependency cover it? Introducing a new library that overlaps 80% with an existing one is almost always a mistake.
- Is it <50 lines of code you could own yourself? (e.g., `is-odd`, `left-pad` — famous for a reason.)
- Cryptography, parsing untrusted binary formats, TLS, auth protocols: *don't* roll your own, even if it seems short.

### 2. Popularity / adoption

- Weekly downloads or equivalent metric. A library with 50/week is either brand new, abandoned, or niche — investigate.
- Used by other well-known projects in the ecosystem?
- Not being in the top 1000 isn't disqualifying, but it raises the bar for the other criteria.

### 3. Maintenance

- Last release within ~12 months, OR the project is mature and stable with quick response to security issues.
- Issues and PRs getting triaged? A tracker with 500 open issues and no activity is a red flag.
- Is there a bus factor of at least 2, or a sponsoring organization?

### 4. Reputation

- **Typosquat check:** Is the name spelled exactly as expected? `lodahs`, `colors-js`, `reqeust`, `cross-env.js`, `event-stream` clones — all real attacks.
- Author/org known in the ecosystem?
- Any history of takeovers, credential compromise, or intentional sabotage by the author?
- Stars/forks consistent with usage? A package with 10M downloads and 8 stars is suspicious.

### 5. Security posture

- Any open unpatched CVEs with high/critical severity? Check `npm audit`, `pip-audit`, `osv.dev`, GitHub advisories.
- Minimal, understandable transitive dependency tree. A utility bringing in 80 transitive deps is a smell.
- No `postinstall` scripts doing network I/O or filesystem writes unless clearly justified (build artifacts, native compilation).
- No unnecessary network permissions, filesystem permissions, or privileged system calls.
- License is acceptable to the project (MIT/BSD/Apache-2 for permissive use; AGPL/GPL may have obligations; unusual or missing license → reject).

### 6. Lock and pin

- Commit the lockfile.
- For CI actions, pin to a commit SHA (`uses: actions/checkout@a1b2c3d…`), not a mutable tag.
- Enable Dependabot / Renovate or equivalent, scoped to security updates at minimum.

## When to reject

Reject and propose an alternative if:

- Abandoned (no meaningful activity for years) with an open security issue.
- Single maintainer with a history of concerning behavior.
- Package does far more than needed, introducing large attack surface.
- Name is a suspected typosquat.
- License is incompatible.
- Unpatched critical CVE with no workaround.

## When to propose an alternative

If you reject, name a concrete replacement. Examples:

- `moment` (maintenance mode, large) → `date-fns`, `dayjs`, or built-in `Intl`.
- `request` (deprecated) → built-in `fetch` (Node 18+), `undici`, or `axios`.
- Tiny one-liner packages (`is-number`, `is-odd`) → inline it.
- Abandoned crypto wrappers → the language's standard crypto library.

## Common pitfalls

- **Bumping a major version without reading the changelog.** Breaking changes often rework security-sensitive defaults (e.g., `axios` redirect handling, `jsonwebtoken` algorithm defaults).
- **Copy-pasting an install command from a random blog.** Verify the package on the official registry before installing.
- **Running `npm install` or `pip install` on a branch you haven't reviewed.** `preinstall`/`postinstall`/setup.py can execute arbitrary code on your machine.
- **Mixing private and public registries** without a scoped config — a public package with the same name as a private one can shadow it (dependency confusion).

## CI/CD supply-chain specifics

- Pin GitHub Actions and equivalent CI plugins to a commit SHA, not a tag.
- Scope tokens narrowly; prefer OIDC federation to long-lived cloud keys.
- Run SCA (dependency scanning) and secret scanning in CI. Fail the build on new critical findings.
- Review Dependabot / Renovate PRs like any other PR — a malicious maintainer's release is still a release.
- For Docker base images: pin by digest, not tag. Rebuild regularly to pick up patches.
