---
id: PLAN-0003
spec: SPEC-0003
title: Docker & local dev — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0003 — Docker & local dev

> Implementation plan for [SPEC-0003](../specs/0003-docker-and-local-dev.md). Depends on [PLAN-0001](./0001-monorepo-and-workspace-plan.md).

## 1. Goal

Provide a one-command local environment: `docker compose up` brings up Postgres 16, a Mailhog mail catcher, and (skeleton) Express services for `api` and `sri-core` plus the Vite dev server for `web`. `.env.example` documents every variable. After this slice:

- `docker compose up` starts all containers; `docker compose ps` shows them healthy.
- `http://localhost:5173` reaches the web stub.
- `http://localhost:3000/health` reaches the API stub and returns 200.
- `http://localhost:3100/health` reaches the SRI Core stub and returns 200.
- Postgres at `localhost:5432` accepts connections with documented credentials.

## 2. Inputs

- [SPEC-0003](../specs/0003-docker-and-local-dev.md) — authoritative.
- [SPEC-0001](../specs/0001-monorepo-and-workspace.md) — workspace layout.
- [ai/context/security.md](../context/security.md) — secrets policy.

## 3. Architecture decisions

| Decision                                                                                                                            | Rationale                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **docker compose v2** (compose plugin), not legacy `docker-compose`.                                                                | Modern syntax, healthchecks, profiles.                  |
| One `Dockerfile` per app, multi-stage (`base → deps → build → runtime`).                                                            | Cacheable layers, small final images.                   |
| Postgres 16 official image; named volume `pgdata`.                                                                                  | Stability + persistence across restarts.                |
| Mailhog for dev SMTP.                                                                                                               | Captures outgoing mail without leaking to real inboxes. |
| Services depend on Postgres via healthcheck.                                                                                        | Avoid race on cold start.                               |
| Network: a single `facturador` bridge network.                                                                                      | Predictable service discovery via DNS names.            |
| Env loading: each app loads its own `.env` from repo root via `node --env-file` or per-app `src/env.ts` Zod-parser (see SPEC-0006). | Single source of truth; no scattered config files.      |
| `.env.example` is committed; `.env*` (without `.example`) is `.gitignore`d (SPEC-0001).                                             | Documents shape; never leaks values.                    |
| Compose `profiles: ["dev"]` for Mailhog, `["test"]` for an ephemeral DB.                                                            | Keeps default `up` minimal.                             |
| Dev volumes mount `apps/<app>/src` for hot reload (Vite, tsx watch).                                                                | Edit ↔ refresh in < 1 s.                               |

## 4. Phases

### Phase 1 — `.env.example` and env loading

1. Create `.env.example` at repo root with every variable, grouped:
   - **Core**: `NODE_ENV`, `LOG_LEVEL`.
   - **Postgres**: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
   - **API**: `API_PORT=3000`, `SESSION_COOKIE_NAME=__Host-facturador_session`, `CSRF_COOKIE_NAME=__Host-facturador_csrf`, `SESSION_TTL_MIN=480`.
   - **SRI Core**: `SRI_CORE_PORT=3100`, `SRI_RECEPCION_URL_PRUEBAS`, `SRI_AUTORIZACION_URL_PRUEBAS`, `SRI_RECEPCION_URL_PROD`, `SRI_AUTORIZACION_URL_PROD`, `SRI_CERT_MASTER_KEY_HEX` (64-char hex; for prod use KMS).
   - **Service auth**: `SERVICE_JWT_SECRET` (256-bit base64).
   - **Mail (dev)**: `SMTP_HOST=mailhog`, `SMTP_PORT=1025`.
   - **Web**: `VITE_API_BASE_URL=http://localhost:3000`.
2. Every variable has a comment line above describing format and acceptable values.

### Phase 2 — Dockerfiles

1. `apps/api/Dockerfile` and `apps/sri-core/Dockerfile`: multi-stage Node 22 alpine. Stages: `base`, `deps` (`pnpm install --frozen-lockfile --filter ...`), `build` (`pnpm --filter @facturador/<app>... build`), `runtime` (copy `dist/`, run as `node user`).
2. `apps/web/Dockerfile`: dev stage only for now (Vite dev server). Production build is later.
3. `.dockerignore` at root: `node_modules`, `dist`, `.env*`, `*.log`, `.git`, `coverage`.

### Phase 3 — `docker-compose.yml`

1. Service `db`: `postgres:16-alpine`, ports `5432:5432`, env from `${POSTGRES_*}`, healthcheck `pg_isready`, volume `pgdata`.
2. Service `mailhog`: `mailhog/mailhog:latest`, ports `1025:1025` and `8025:8025`, profile `dev`.
3. Service `api`: built from `apps/api/Dockerfile`, depends_on db (healthy), env-file `./.env`, ports `${API_PORT}:3000`, volume mount `./apps/api/src:/app/apps/api/src:ro` for hot reload via `tsx watch`.
4. Service `sri-core`: same pattern as api, ports `${SRI_CORE_PORT}:3100`.
5. Service `web`: built from `apps/web/Dockerfile` (dev), ports `5173:5173`, mount `./apps/web/src:/app/apps/web/src:ro`.

### Phase 4 — Health endpoints (stubs)

For `apps/api` and `apps/sri-core`:

- `src/server.ts` creates an Express 5 app with a single `GET /health` handler returning `{ status: "ok", service: "api"|"sri-core", uptimeSec: <n> }`.
- `src/index.ts` boots the server using a Zod-validated env. **No business logic** — that lives in later specs.

### Phase 5 — Local dev scripts

Add to root `package.json` scripts:

- `"dev": "docker compose up --build"`
- `"dev:down": "docker compose down -v"`
- `"db:psql": "docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB"`

### Phase 6 — Verification

- `cp .env.example .env`
- `docker compose up -d db api sri-core web mailhog`
- `curl -fsS localhost:3000/health` returns 200 with JSON body.
- `curl -fsS localhost:3100/health` returns 200.
- `curl -I localhost:5173` returns 200 from Vite.
- `docker compose exec db pg_isready` returns "accepting connections".

## 5. Risks & mitigations

| Risk                                            | Mitigation                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Port collisions on developer machines.          | Document overrides via `.env`; default ports chosen to avoid common conflicts.        |
| Hot reload loops due to volume mounts on macOS. | Use `:cached` mount option; tsx watch with debounced restart.                         |
| `node_modules` copied from host (slow).         | `.dockerignore` excludes `node_modules`; `pnpm install` runs inside the build stage.  |
| Compose bringing up everything by default.      | Use `profiles` to keep mailhog out unless `--profile dev`.                            |
| `__Host-` cookies fail on `http://localhost`.   | Document: only set `__Host-` prefix when `NODE_ENV=production`; dev uses plain names. |

## 6. Validation strategy

- All four health endpoints return 200.
- Killing the API and running `docker compose up api` again restarts cleanly.
- `docker compose down -v` clears volumes; next `up` creates fresh DB.
- `docker compose config` validates the file shape (`exit 0`).

## 7. Exit criteria

- SPEC-0003 acceptance criteria all green.
- Bring-up time from `docker compose up --build` to all healthchecks green < 90 s on dev hardware.

## 8. Out of scope

- Production CI image registry pushes.
- TLS termination / nginx ingress.
- Prisma migrations / seeding (SPEC-0004).
- Real auth / business endpoints.
