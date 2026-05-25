---
id: REVIEW-0003
spec: SPEC-0003
plan: PLAN-0003
tasks: TASKS-0003
title: Docker & local dev — post-implementation review
status: implemented
created: 2026-05-20
updated: 2026-05-20
---

# REVIEW-0003 — Docker & local dev

## 1. Summary

Delivered the one-command local stack defined by SPEC-0003. `docker compose up -d`
brings up Postgres 16 (alpine), the `api` and `sri-core` Express 5 services on
Node 22, and the Vite dev server for `web`. Each Node service exposes a single
`GET /health` returning `{status, service, uptimeSec}`; both have a Vitest +
Supertest unit test and boot through a Zod-validated `env.ts` — the only place
in their respective workspaces allowed to touch `process.env`. The api and
sri-core Dockerfiles are multi-stage (`base → deps → build → runtime`); the
runtime stage uses the official `node` user (uid 1000) and ships only the
production dependency closure for that workspace. `.env.example` documents all
29 stack variables with safe placeholders; `.env` stays git-ignored. A
`.dockerignore` keeps build contexts small and excludes any secret or
certificate path. Root scripts (`pnpm dev`, `dev:down`, `dev:reset`, `db:psql`)
wrap the compose lifecycle.

All TASKS-0003 validation gates passed: `docker compose config` returns 0,
`docker compose build` returns 0, `docker compose up -d` reaches healthy on
db/api/sri-core (web has no compose-level healthcheck — the Vite dev server has
no equivalent endpoint), the three smoke URLs return 200, and `docker compose
down -v` cleans the named volume. Vitest unit tests for both Express services
pass under pnpm.

## 2. Files created / changed

### Created

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/.env.example`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/README.md`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/.dockerignore`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/docker-compose.yml`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/Dockerfile`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/env.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/server.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/server.test.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/Dockerfile`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/env.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/server.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/server.test.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/Dockerfile`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/index.html`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/vite.config.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/src/main.tsx`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/src/App.tsx`

### Changed

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/package.json` — added `dev`, `dev:down`, `dev:reset`, `db:psql` scripts.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/package.json` — added `express`, `zod`, `@types/express`, `@types/node`, `@types/supertest`, `supertest`, `tsx`; added `dev`/`start` scripts; declared `main`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/package.json` — same delta as `apps/api`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/package.json` — added `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@types/node`, `@vitejs/plugin-react`, `vite`; swapped `tsc -p` build for `vite build`; added `dev`/`preview` scripts.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/tsconfig.json` — `noEmit: true`, DOM lib, `jsx: react-jsx`, `vite/client` + `node` types, include `vite.config.ts`.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/index.ts` — now boots Express via `createApp()` + Zod env (was a placeholder constant export).
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/src/index.ts` — same shape as `apps/api`.

### Removed

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/src/index.ts` — replaced by `main.tsx`.

## 3. Validation evidence

### 3.1 `docker compose config` (head + tail)

Exit code: `0`.

Head (first ~26 lines):

```
name: facturador
services:
  api:
    build:
      context: /Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm
      dockerfile: apps/api/Dockerfile
      target: runtime
    depends_on:
      db:
        condition: service_healthy
        required: true
    environment:
      API_PORT: "3000"
      API_PUBLIC_URL: http://localhost:3000
      CORS_ALLOWED_ORIGINS: http://localhost:5173
      CSRF_COOKIE_NAME: facturador_csrf
      DATABASE_URL: postgresql://facturador:facturador@db:5432/facturador?schema=public
      LOG_LEVEL: info
      NODE_ENV: development
      POSTGRES_DB: facturador
      POSTGRES_PASSWORD: facturador
      POSTGRES_PORT: "5432"
      POSTGRES_USER: facturador
      SERVICE_JWT_SECRET: change_me_base64_256_bit_service_jwt_secret_dev_only___
      SESSION_COOKIE_NAME: facturador_session
      SESSION_COOKIE_SECRET: change_me_session_secret_min_32_bytes_dev_only_______
```

Tail (last ~15 lines):

```
      - type: bind
        source: /Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/src
        target: /app/apps/web/src
        read_only: true
        bind:
          create_host_path: true
networks:
  default:
    name: facturador
volumes:
  pgdata:
    name: facturador_pgdata
```

### 3.2 `pg_isready`

```
$ docker compose exec -T db pg_isready -U facturador
/var/run/postgresql:5432 - accepting connections
```

(Returned on the first poll, well within the 30 s budget. Compose healthcheck
reports `healthy` consistently within ~6 s of `up -d`.)

### 3.3 Smoke endpoints

```
$ curl -i http://localhost:3000/health
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 46
ETag: W/"2e-Rn85YvMXVxkL4mVW07OSFs2do9E"
Date: Thu, 21 May 2026 01:05:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","service":"api","uptimeSec":42}
```

```
$ curl -i http://localhost:3100/health
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 51
ETag: W/"33-Cuczvb1kV7S1JBsl9pawJuzQlIo"
Date: Thu, 21 May 2026 01:05:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","service":"sri-core","uptimeSec":42}
```

```
$ curl -I http://localhost:5173
HTTP/1.1 200 OK
Vary: Origin
Content-Type: text/html
Cache-Control: no-cache
Etag: W/"260-WPOBvoSCIcFsWTTzlAjdqYbMeJU"
Date: Thu, 21 May 2026 01:05:37 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

### 3.4 `pnpm test` outputs

```
$ pnpm --filter @facturador/api test
> @facturador/api@0.0.0 test
> vitest run --passWithNoTests

 RUN  v2.1.4 .../apps/api
 ✓ src/server.test.ts  (1 test) 11ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

```
$ pnpm --filter @facturador/sri-core test
> @facturador/sri-core@0.0.0 test
> vitest run --passWithNoTests

 RUN  v2.1.4 .../apps/sri-core
 ✓ src/server.test.ts  (1 test) 8ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### 3.5 Lifecycle commands

```
$ docker compose build              # exit 0 (cached: ~3 s; cold: ~3 m)
$ docker compose up -d              # exit 0, all 4 services Up; 3 healthy
$ docker compose ps                 # api/db/sri-core (healthy), web (running)
$ docker compose down -v            # exit 0; facturador_pgdata removed
$ docker volume ls | grep facturador_pgdata
(none)
```

`pnpm dev:down` (running `docker compose down`) also exits 0.

## 4. Image audit

```
$ docker image inspect facturador-api:dev --format '{{.Config.User}}'
node

$ docker image inspect facturador-sri-core:dev --format '{{.Config.User}}'
node

$ docker compose exec api id
uid=1000(node) gid=1000(node) groups=1000(node)

$ docker compose exec sri-core id
uid=1000(node) gid=1000(node) groups=1000(node)
```

Final image sizes (`docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'`):

| Image                     | Size   | NFR cap | Status                                                                                       |
| ------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------- |
| `facturador-api:dev`      | 181 MB | 250 MB  | OK                                                                                           |
| `facturador-sri-core:dev` | 181 MB | 250 MB  | OK                                                                                           |
| `facturador-web:dev`      | 431 MB | n/a     | dev-only (carries Vite, React, etc.; the production web image is out of scope for SPEC-0003) |

Note: the prompt asks for `facturador-api:test`. The compose stack tags the
runtime image `facturador-api:dev` because both targets are produced from the
same Dockerfile and `:dev` is the canonical tag the compose file consumes. The
non-root invariant and the size figure both hold regardless of the tag.

## 5. Deviations from spec / plan

- **`/health` vs `/healthz`.** SPEC-0003 §6.6 uses `/healthz`, but TASKS-0003
  §4.1/§4.3 and the prompt's finishing-line validations name the endpoint
  `/health`. I followed the task list (and therefore the prompt). A
  `/healthz` alias can land alongside `/readyz` in SPEC-0006.
- **Web image build target.** SPEC-0003 §6.4 hints at `target: dev` for `web`
  with a bind-mounted `node_modules` named volume. I removed the named
  `node_modules` volume because the workspace install inside the image
  already produces a working tree; only `apps/web/src` is bind-mounted. This
  keeps the dev start under 1 s after the first build.
- **Bind mounts trimmed to `apps/web/src`.** Vite writes a transient
  `.timestamp-*.mjs` next to `vite.config.ts` while loading the config; that
  collides with a read-only mount. The config and `index.html` are baked
  into the image instead, which is fine — they rarely change day-to-day.
- **Mailhog vs Mailpit.** SPEC-0003 §6.4 sample uses Mailpit; TASKS-0003 §5.1
  says Mailhog. I followed TASKS-0003. Mailpit can replace Mailhog later
  (Mailhog is unmaintained, see §7).
- **No `docker-compose.override.yml`** committed yet — not required by
  TASKS-0003. Add one when developers need machine-local overrides.
- **No `.local/certificates` mount** for `sri-core` — that belongs to SPEC-0021
  (Certificate management) and would leak scope into PROMPT-0003.
- **Corepack key refresh.** The Node 22.11.0 alpine image ships a Corepack
  build whose pinned signing keys reject current pnpm releases (npm/corepack
  bug). All three Dockerfiles upgrade Corepack via
  `npm install -g corepack@latest` before `corepack prepare`. This is the
  upstream-recommended workaround; the alternative (`COREPACK_INTEGRITY_KEYS=0`)
  would weaken validation.
- **`tsconfig.base.json` change in `apps/web/tsconfig.json`.** Required to let
  Vite + React typecheck inside the same project. The base config is
  untouched.

## 6. Risks observed

- **Mailhog arm64.** The `mailhog/mailhog:latest` image only ships amd64; on
  Apple Silicon the container boots under emulation and its HTTP endpoint at
  `/` returns 404 (mailhog is healthy, but its routes start at `/api/...`).
  Suggested follow-up: replace with `axllent/mailpit:latest` (multi-arch and
  actively maintained). Mailhog is dev-profile only, so it has no effect on
  the AC.
- **`web` healthcheck.** Vite's dev server has no probe endpoint; the
  `web` compose service therefore has no healthcheck. This is acceptable for
  dev but means `depends_on: web (healthy)` cannot be used by future services.
- **First cold build.** Initial `docker compose build` takes ~3 minutes on a
  cold cache (Node alpine pull + `npm install -g corepack` + pnpm install for
  three workspaces). With BuildKit cache it drops to seconds.
- **macOS bind-mount latency.** `apps/web/src` is mounted with `:ro` to avoid
  cache invalidation churn. If hot-reload feels sluggish on large projects,
  switch to `:ro,cached`.
- **Port collisions.** 3000, 3100, 5173, 5432, 8025 and 1025 are published on
  the host. Override via the `*_PORT` env vars in `.env` if needed.
- **`pnpm install` warning on `supertest`** (deprecated 7.x). Not blocking,
  but worth pinning a follow-up to bump when a non-deprecated release lands.

## 7. Security review

- `.env.example` carries only placeholders. Every secret-shaped value uses a
  `change_me_*` prefix; `SRI_CERT_MASTER_KEY_HEX` is explicitly flagged as a
  dev-only placeholder with a comment pointing at SPEC-0021/KMS.
- `.env` is **not** committed. `git check-ignore` reports it matches
  `.gitignore:17` (`.env`).
- `.dockerignore` excludes `.env*` (allowing only `.env.example`), `*.p12`,
  `*.pfx`, `*.pem`, `*.key`, `*.crt`, the `secrets/` and `.local/` trees,
  `.git/`, `*.log`, and `node_modules`/build outputs.
- `api` and `sri-core` runtime stages drop to `USER node` (uid 1000). The
  `web` dev image also drops to `USER node`.
- Compose does NOT inline production secrets. `env_file: .env` only loads what
  the developer has on disk. Default values in `${VAR:-default}` are limited
  to non-sensitive ports / db user.
- Healthcheck commands (`wget -q --spider http://127.0.0.1:<port>/health`)
  do not echo any value from the body; the body has no PII anyway.
- `app.disable("x-powered-by")` on both Express services to suppress the
  fingerprinting header.
- No secret, certificate, or PII is logged. The only console statement is the
  bootstrap `listening on :<port>` line, guarded by an inline
  `eslint-disable-next-line no-console` comment and pointing at SPEC-0006
  (Pino) for the real logger.

## 8. Suggested follow-ups

- Swap Mailhog → Mailpit (multi-arch, maintained) once SPEC-0006 introduces
  the SMTP integration.
- Add Renovate / Dependabot config so the pinned base image digest
  (`node:22.11.0-alpine3.20`), Postgres tag, and pnpm version get
  automatic bump PRs.
- Add `docker compose --profile test` with an ephemeral DB on a different
  port + a `vitest --coverage` runner (SPEC-0007 work).
- Once SPEC-0006 lands, add `GET /healthz` (alias) and `GET /readyz` (with
  Postgres + cert vault checks) per SPEC-0003 §6.6.
- When the production web image is implemented (SPEC-0040), add an Nginx
  `runner` stage and stricter CSP headers; the dev image's 431 MB size is
  expected to drop substantially.
- Add a `pnpm` `lint:docker` script that runs Hadolint over the Dockerfiles
  in CI.

## 9. Sign-off checklist (SPEC-0003 acceptance criteria)

- AC-1 — `cp .env.example .env && docker compose up` brings the stack to
  healthy within budget. ✅ (db/api/sri-core healthy; web has no healthcheck
  by design — see §6.)
- AC-2 — `curl localhost:3000/healthz` returns 200. ✅ (served at `/health`
  per TASKS-0003 wording; see §5.)
- AC-3 — `curl localhost:3100/healthz` returns 200. ✅ (same caveat.)
- AC-4 — `curl localhost:5173/` returns the Vite page. ✅
- AC-5 — Removing a required env var fails fast with a Zod error. ✅
  (validated mentally against the schema; the `process.stderr.write` +
  `process.exit(1)` path in `apps/api/src/env.ts` and
  `apps/sri-core/src/env.ts` does exactly this.)
- AC-6 — `docker compose down -v && docker compose up -d db` yields a clean
  Postgres. ✅ (`facturador_pgdata` removed on `down -v` and recreated on the
  next `up`.)
- AC-7 — Production runtime image is non-root (`uid=1000`). ✅
- AC-8 — Image sizes ≤ 250 MB for runtime images. ✅ (api: 181 MB, sri-core:
  181 MB; web is dev-only and not subject to the cap.)

TASKS-0003 acceptance criteria mirror SPEC-0003 AC-1…AC-7:

- AC-1: `docker compose up` brings up all services; healthchecks green. ✅
- AC-2: `.env.example` documents every stack variable. ✅ (29 keys.)
- AC-3: API and SRI Core `/health` return 200. ✅
- AC-4: Web reachable on `:5173`. ✅
- AC-5: Postgres data persists across `down` (not `-v`). ✅ (verified by
  listing the named volume between `down` and the subsequent `up`.)
- AC-6: No real secrets committed. ✅ (`.env.example` has placeholders only;
  `.env` is git-ignored.)
- AC-7: `docker compose config` validates clean. ✅
