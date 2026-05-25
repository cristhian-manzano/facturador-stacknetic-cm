---
id: SPEC-0003
title: Docker & local development environment
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001]
blocks: [SPEC-0004, SPEC-0010, SPEC-0020]
---

# SPEC-0003 — Docker & local dev

## 1. Purpose

Provide a one-command local environment for the whole stack: Postgres, API, SRI Core, Web. No developer should need to install Postgres natively. Also defines the Dockerfile contract for production-ready images.

## 2. Scope

### 2.1 In scope

- `docker-compose.yml` for local dev with Postgres 16, API, SRI Core, Web, and a `mailhog`-like SMTP catcher for future use.
- Multi-stage `Dockerfile` per app, optimised for pnpm + Node 22.
- Environment variable loading: `.env`, `.env.local`, `.env.example`, Zod-validated.
- Health checks for every service.
- Volumes for Postgres data and certificate uploads (dev only).
- Networking: services talk over a docker network using service names as hosts.
- `Makefile` (or pnpm scripts) wrapping common dev tasks: `db:up`, `db:reset`, `dev`, `migrate`, `seed`.

### 2.2 Out of scope

- Kubernetes manifests (later).
- Production registry, secrets manager integration (later).
- CDN / reverse proxy for production (later).

## 3. Context & references

- [SPEC-0001](./0001-monorepo-and-workspace.md) — workspace layout.
- [`ai/context/security.md`](../context/security.md) — trust zones inform service isolation.
- [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md) §9 — TLS expectations.

## 4. Functional requirements

- **FR-1.** `docker compose up` brings up all services with health checks and depends-on ordering. App services wait for the DB to be healthy.
- **FR-2.** `docker compose down -v` cleans data; `docker compose down` keeps the named volumes.
- **FR-3.** Each service exposes a `GET /healthz` that returns `200 {"status":"ok"}` once dependencies are reachable.
- **FR-4.** Environment variables are loaded with the precedence: process env > `.env.local` > `.env`. Validated by Zod at boot — fail fast on invalid env.
- **FR-5.** A Postgres named volume persists across `docker compose down` but is wiped on `docker compose down -v`.
- **FR-6.** Production images (target stage `runner`) run as a non-root user (`uid 1000`) and contain no dev dependencies.
- **FR-7.** Local SRI Core has a mounted volume `./.local/certificates` where developers drop test `.p12` files for the cert-upload UI to read. **This volume must never appear in production manifests.**

## 5. Non-functional requirements

- **NFR-1.** Cold `docker compose up` ≤ 60 s after first build.
- **NFR-2.** Production image size per app ≤ 250 MB.
- **NFR-3.** Image build is reproducible: pinned base image digests; lockfile-only installs (`pnpm install --frozen-lockfile`).

## 6. Technical design

### 6.1 Directory layout (added by this spec)

```
.
├── docker-compose.yml
├── docker-compose.override.yml          # local-only overrides (gitignored example provided)
├── .env.example
├── apps/api/Dockerfile
├── apps/sri-core/Dockerfile
├── apps/web/Dockerfile
├── apps/web/nginx.conf                  # for production static serve
└── .local/                              # gitignored — local-only artifacts
    └── certificates/                    # mounted into sri-core dev container
```

Add to `.gitignore`: `.local/`, `docker-compose.override.yml`.

### 6.2 `.env.example` (canonical — every env var lives here, with safe defaults / placeholders)

```bash
# === General ===
NODE_ENV=development
LOG_LEVEL=info

# === Postgres ===
POSTGRES_USER=facturador
POSTGRES_PASSWORD=facturador
POSTGRES_DB=facturador
POSTGRES_PORT=5432
DATABASE_URL=postgresql://facturador:facturador@db:5432/facturador?schema=public

# === API ===
API_PORT=3000
API_PUBLIC_URL=http://localhost:3000
SESSION_COOKIE_NAME=__Host-facturador.sid
SESSION_COOKIE_SECRET=change-me-32-bytes-minimum-please
CSRF_COOKIE_NAME=__Host-facturador.csrf
CORS_ALLOWED_ORIGINS=http://localhost:5173

# === SRI Core ===
SRI_CORE_PORT=3100
SRI_CORE_PUBLIC_URL=http://localhost:3100
SRI_CORE_SERVICE_TOKEN_SECRET=change-me-32-bytes-minimum-please
# AES-256 master key (32 bytes hex) used to encrypt .p12 blobs at rest in dev only.
# In prod this comes from a real KMS — see SPEC-0021.
SRI_CERT_MASTER_KEY_HEX=00000000000000000000000000000000000000000000000000000000deadbeef

# === SRI endpoints (defaults are PRUEBAS — production deploys override) ===
SRI_AMBIENTE_DEFAULT=1
SRI_RECEPCION_URL_PRUEBAS=https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
SRI_AUTORIZACION_URL_PRUEBAS=https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl
SRI_RECEPCION_URL_PRODUCCION=https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
SRI_AUTORIZACION_URL_PRODUCCION=https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl
SRI_HTTP_TIMEOUT_MS=30000

# === Web ===
WEB_PORT=5173
VITE_API_BASE_URL=http://localhost:3000
```

### 6.3 Env validation per app

Each app exposes `src/env.ts` with a Zod schema. Example for API:

```ts
// apps/api/src/env.ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_PUBLIC_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(32),
  CSRF_COOKIE_NAME: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().transform((s) => s.split(",").map((x) => x.trim())),
  SRI_CORE_PUBLIC_URL: z.string().url(),
  SRI_CORE_SERVICE_TOKEN_SECRET: z.string().min(32),
});

export type AppEnv = z.infer<typeof Env>;

export const env: AppEnv = Env.parse(process.env);
```

(Only file in the repo where `process.env.*` access is allowed; see [SPEC-0002](./0002-shared-tooling.md) §6.4.)

### 6.4 `docker-compose.yml`

```yaml
# docker-compose.yml — DEV by default. Production uses overlays.
name: facturador

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_PORT}:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: dev
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public
      SRI_CORE_PUBLIC_URL: http://sri-core:3100
    ports:
      - "${API_PORT}:3000"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - .:/workspace
      - /workspace/node_modules
    command: pnpm --filter @facturador/api dev
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/healthz"]
      interval: 10s
      timeout: 3s
      retries: 10

  sri-core:
    build:
      context: .
      dockerfile: apps/sri-core/Dockerfile
      target: dev
    env_file: .env
    ports:
      - "${SRI_CORE_PORT}:3100"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - .:/workspace
      - /workspace/node_modules
      - ./.local/certificates:/var/lib/facturador/certificates:ro
    command: pnpm --filter @facturador/sri-core dev
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3100/healthz"]
      interval: 10s
      timeout: 3s
      retries: 10

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: dev
    env_file: .env
    ports:
      - "${WEB_PORT}:5173"
    depends_on:
      - api
    volumes:
      - .:/workspace
      - /workspace/node_modules
    command: pnpm --filter @facturador/web dev -- --host 0.0.0.0

  mail:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "1025:1025" # SMTP
      - "8025:8025" # web UI

volumes:
  pg-data:
```

### 6.5 Dockerfile per app (production-grade multi-stage; identical pattern)

`apps/api/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.9.0-alpine
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

# --- Dependencies (cached) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY packages/utils/package.json packages/utils/
COPY packages/logger/package.json packages/logger/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- Dev target (used by docker-compose) ---
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "@facturador/api", "dev"]

# --- Build target ---
FROM deps AS build
COPY . .
RUN pnpm -r --filter @facturador/api... build

# --- Runtime ---
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
RUN addgroup -g 1000 app && adduser -u 1000 -G app -s /bin/sh -D app
WORKDIR /app
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/package.json ./
# Production node_modules (workspace-resolved). Use pnpm deploy or copy hoisted modules.
COPY --from=build /workspace/node_modules /app/node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q --spider http://localhost:3000/healthz || exit 1
CMD ["node", "dist/main.js"]
```

The same pattern applies to `apps/sri-core/Dockerfile` (port 3100, entry `dist/main.js`) and `apps/web/Dockerfile` (uses Nginx in the `runner` stage to serve the Vite build).

`apps/web/Dockerfile` (runner stage only differs):

```dockerfile
FROM nginx:alpine AS runner
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK CMD wget -q --spider http://localhost/ || exit 1
```

`apps/web/nginx.conf` (SPA fallback + security headers):

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # SPA fallback
  location / { try_files $uri /index.html; }

  # Security headers
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
  # CSP must be tuned per app; this is a baseline.
  add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; connect-src 'self' ${VITE_API_BASE_URL}; style-src 'self' 'unsafe-inline'; script-src 'self'" always;
}
```

### 6.6 Health endpoints contract

Every Node service exposes:

```
GET /healthz                    -> 200 { "status": "ok" }
GET /readyz                     -> 200 { "status": "ok", "checks": {...} } | 503 on dependency failure
```

`/readyz` checks: Postgres ping for API; Postgres + cert vault for SRI Core. Latencies recorded.

### 6.7 Common dev commands (added to root `package.json`)

```jsonc
{
  "scripts": {
    "db:up": "docker compose up -d db",
    "db:reset": "docker compose down -v && docker compose up -d db",
    "db:psql": "docker compose exec db psql -U facturador -d facturador",
    "up": "docker compose up --build",
    "down": "docker compose down",
    "logs": "docker compose logs -f --tail=200",
  },
}
```

## 7. Implementation guide

### 7.1 Steps

1. Copy `.env.example` → `.env` (developer step, documented in README).
2. Add files from §6.1–§6.7 to the repo.
3. Add `src/env.ts` to each app (`apps/api`, `apps/sri-core`, `apps/web`) per §6.3, importing `zod`.
4. Add `pnpm exec lefthook install` to `prepare`.
5. `pnpm install`; `pnpm db:up`; `pnpm dev`.
6. Verify all four services reach healthy and respond to `/healthz`.

### 7.2 Dependencies to install

| Workspace                   | Package | Version   | Purpose                |
| --------------------------- | ------- | --------- | ---------------------- |
| `apps/api`, `apps/sri-core` | `zod`   | `^3.23.0` | Env validation.        |
| `apps/web`                  | `zod`   | `^3.23.0` | Form + env validation. |

### 7.3 Conventions

- One `.env` file per developer, **not** committed.
- `.env.example` is the source of truth — every new env var **must** be added here with a safe placeholder.
- Production deploys read env from the platform secret manager — never from a baked `.env`.

## 8. Acceptance criteria

- **AC-1.** `cp .env.example .env && docker compose up` brings the stack to healthy in ≤ 90 s.
- **AC-2.** `curl localhost:3000/healthz` returns `200`.
- **AC-3.** `curl localhost:3100/healthz` returns `200`.
- **AC-4.** `curl localhost:5173/` returns the Vite dev page.
- **AC-5.** Removing a required env var causes the affected app to exit `1` at boot with a clear Zod error.
- **AC-6.** `docker compose down -v && docker compose up -d db` produces a clean Postgres instance.
- **AC-7.** Production target stage of each Dockerfile builds (`docker build --target runner -t facturador-api .`) and the resulting image runs as non-root (`docker run --rm facturador-api id` reports `uid=1000`).
- **AC-8.** Image sizes verified ≤ 250 MB (`docker images`).

## 9. Test plan

- Manual smoke tests for AC-1 through AC-8.
- Repeated builds with no cache to verify reproducibility: `docker build --no-cache` twice → identical SHA at the build stage (with deterministic base image).

## 10. Security considerations

- **Never** commit `.env`. `.gitignore` already excludes it (set in [SPEC-0001](./0001-monorepo-and-workspace.md)).
- The dev-only `SRI_CERT_MASTER_KEY_HEX` is **placeholder**. Production must source it from KMS — see [SPEC-0021](./0021-certificate-management.md).
- Mounted `./.local/certificates` is dev-only — production deploys must omit this mount.
- Nginx CSP is a baseline; tighten when the Web app's needs are known.
- All services bind to `0.0.0.0` inside the container, but Docker only publishes intended ports to the host.

## 11. Observability

- `/healthz` is a liveness probe. `/readyz` is a readiness probe with dependency checks.
- `docker compose logs -f` is the dev observability story; production uses platform log collectors (later spec).

## 12. Risks and mitigations

| Risk                                | Mitigation                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Volume-mount slowness on macOS      | Use named volumes for `node_modules` (already in compose).                               |
| Image bloat from copying everything | Per-app Dockerfile copies only `apps/<app>/dist` + needed manifests in the runner stage. |
| Dev/prod drift                      | Both stages share `deps` and `build`. Only `runner` differs.                             |

## 13. Open questions

- Use `pnpm deploy` to produce a slim, self-contained per-app `node_modules` for the runner stage? Defer until image size becomes a problem.
- Add Redis to compose? Not needed for the initial milestone. Add when caching is justified.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
