---
id: TASKS-0003
spec: SPEC-0003
plan: PLAN-0003
title: Docker & local dev — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0003 — Docker & local dev

> Checklist for [SPEC-0003](../specs/0003-docker-and-local-dev.md) + [PLAN-0003](../plans/0003-docker-and-local-dev-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `latest` tags on production-relevant images (Postgres, Node). Pin exact major+minor.
- ❌ Never commit `.env` (only `.env.example`).
- ❌ Never embed real credentials in compose env defaults.
- ✅ Healthchecks must actually fire; "manual curl" is acceptable validation but a compose healthcheck is required for `db`, `api`, `sri-core`.

## 1. `.env.example`

- [ ] **1.1** Create `.env.example` at repo root with the following sections and example values (each preceded by a comment describing format). Use placeholder values for secrets (e.g., `change_me_to_64_hex_chars`):

  - `NODE_ENV=development`
  - `LOG_LEVEL=info`
  - Postgres: `DATABASE_URL=postgresql://facturador:facturador@db:5432/facturador?schema=public`, `POSTGRES_USER=facturador`, `POSTGRES_PASSWORD=facturador`, `POSTGRES_DB=facturador`
  - API: `API_PORT=3000`, `SESSION_COOKIE_NAME=facturador_session` (dev; production overrides to `__Host-facturador_session`), `CSRF_COOKIE_NAME=facturador_csrf`, `SESSION_TTL_MIN=480`
  - SRI Core: `SRI_CORE_PORT=3100`, `SRI_RECEPCION_URL_PRUEBAS=https://celcer.sri.gob.ec/...`, `SRI_AUTORIZACION_URL_PRUEBAS=...`, `SRI_RECEPCION_URL_PROD=...`, `SRI_AUTORIZACION_URL_PROD=...`, `SRI_CERT_MASTER_KEY_HEX=<64-hex-chars>` (DO NOT use a real key here)
  - Service auth: `SERVICE_JWT_SECRET=<base64-256-bit>`
  - Mail: `SMTP_HOST=mailhog`, `SMTP_PORT=1025`
  - Web: `VITE_API_BASE_URL=http://localhost:3000`
    **Validate**: `grep -c '^[A-Z_]\+=' .env.example` returns ≥ 15.

- [ ] **1.2** Add a line to root `README.md` (create if missing) explaining `cp .env.example .env` is the first step.
      **Validate**: `grep -F ".env.example" README.md` returns at least one line.

## 2. `.dockerignore`

- [ ] **2.1** Create `.dockerignore` at repo root with:
  ```
  node_modules
  **/node_modules
  dist
  **/dist
  coverage
  **/coverage
  .env
  .env.*
  !.env.example
  .git
  .gitignore
  *.log
  ```
  **Validate**: `test -f .dockerignore && head -1 .dockerignore`.

## 3. Dockerfiles

- [ ] **3.1** Create `apps/api/Dockerfile` with multi-stage build:

  - `FROM node:22-alpine AS base` (sets `WORKDIR /app`, installs `pnpm@9.x` via Corepack).
  - `FROM base AS deps` (copies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, all workspace `package.json`s; runs `pnpm install --frozen-lockfile --filter @facturador/api...`).
  - `FROM deps AS build` (copies sources; `pnpm --filter @facturador/api build`).
  - `FROM node:22-alpine AS runtime` (copies `dist/`, sets `USER node`, `CMD ["node","apps/api/dist/index.js"]`).
    **Validate**: `docker build -f apps/api/Dockerfile -t facturador-api:test .` exits 0.

- [ ] **3.2** Same pattern for `apps/sri-core/Dockerfile`.
      **Validate**: `docker build -f apps/sri-core/Dockerfile -t facturador-sri:test .` exits 0.

- [ ] **3.3** Create `apps/web/Dockerfile` for dev only:
  - `FROM node:22-alpine`, installs pnpm, copies workspace files, runs `pnpm install --frozen-lockfile --filter @facturador/web...`, exposes 5173, `CMD ["pnpm","--filter","@facturador/web","dev","--host","0.0.0.0"]`.
    **Validate**: `docker build -f apps/web/Dockerfile -t facturador-web:test .` exits 0.

## 4. Health endpoint stubs

- [ ] **4.1** In `apps/api/src/server.ts`: create an Express 5 app exporting `createApp()` returning `app` with `app.get("/health", (req, res) => res.json({ status: "ok", service: "api", uptimeSec: Math.floor(process.uptime()) }))`. No other routes.
      **Validate**: a unit test in `apps/api/src/server.test.ts` using Supertest asserts 200 + body. `pnpm --filter @facturador/api test` exits 0.

- [ ] **4.2** In `apps/api/src/index.ts`: import `createApp`, read `API_PORT` from a Zod-validated `env.ts` (placeholder schema acceptable for now), `app.listen(port)`.
      **Validate**: `node apps/api/dist/index.js` starts and prints `listening on :3000` (or whatever value is in env).

- [ ] **4.3** Repeat 4.1 and 4.2 for `apps/sri-core` with `service: "sri-core"` and port 3100.
      **Validate**: same as above; `pnpm --filter @facturador/sri-core test` exits 0.

## 5. `docker-compose.yml`

- [ ] **5.1** Create `docker-compose.yml` at root with:
  - `services.db`: `postgres:16-alpine`, env from `.env`, ports `${POSTGRES_PORT:-5432}:5432`, volume `pgdata:/var/lib/postgresql/data`, healthcheck `pg_isready -U $$POSTGRES_USER` every 10s.
  - `services.api`: build context `.`, dockerfile `apps/api/Dockerfile`, depends_on `db: { condition: service_healthy }`, env_file `./.env`, ports `${API_PORT:-3000}:3000`, healthcheck `wget -qO- localhost:3000/health || exit 1`.
  - `services.sri-core`: same pattern, ports `${SRI_CORE_PORT:-3100}:3100`.
  - `services.web`: build via `apps/web/Dockerfile`, ports `5173:5173`, mounts `./apps/web/src:/app/apps/web/src:ro`.
  - `services.mailhog`: `mailhog/mailhog:latest`, ports `8025:8025` and `1025:1025`, `profiles: ["dev"]`.
  - `volumes.pgdata`.
  - `networks.facturador` (default).
    **Validate**: `docker compose config` exits 0 and prints the resolved YAML.

## 6. Bring-up & smoke test

- [ ] **6.1** `cp .env.example .env`.
      **Validate**: `test -f .env`.

- [ ] **6.2** `docker compose up -d db`.
      **Validate**: `docker compose exec db pg_isready -U facturador` returns "accepting connections" within 30 s.

- [ ] **6.3** `docker compose up -d api sri-core web`.
      **Validate**:

  - `curl -fsS localhost:3000/health` → status 200, body contains `"service":"api"`.
  - `curl -fsS localhost:3100/health` → status 200, body contains `"service":"sri-core"`.
  - `curl -I localhost:5173` → HTTP/1.1 200 OK (Vite returns the index page).

- [ ] **6.4** `docker compose --profile dev up -d mailhog`.
      **Validate**: `curl -I localhost:8025` returns 200.

- [ ] **6.5** `docker compose down`.
      **Validate**: exit 0; data persists (`pgdata` volume still present unless `-v`).

- [ ] **6.6** `docker compose down -v`.
      **Validate**: `pgdata` volume removed; `docker volume ls | grep pgdata` empty.

## 7. Root scripts

- [ ] **7.1** Add to root `package.json` scripts:
  ```json
  "dev": "docker compose up --build",
  "dev:down": "docker compose down",
  "dev:reset": "docker compose down -v",
  "db:psql": "docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB"
  ```
  **Validate**: `pnpm dev:down` exits 0 (no services to stop is acceptable).

## 8. Acceptance criteria

- [ ] AC-1: `docker compose up` brings up all services; healthchecks green.
- [ ] AC-2: `.env.example` documents every variable used by the stack.
- [ ] AC-3: API and SRI Core `/health` return 200.
- [ ] AC-4: Web reachable on `:5173`.
- [ ] AC-5: Postgres data persists across `down` / `up` (not `down -v`).
- [ ] AC-6: No real secrets committed.
- [ ] AC-7: `docker compose config` validates clean.

## 9. Definition of Done

- All tasks ticked, all curl smoke tests return expected status.
- `docker compose down -v` cleans state.
- Review file `ai/reviews/0003-docker-and-local-dev-review.md` written.
