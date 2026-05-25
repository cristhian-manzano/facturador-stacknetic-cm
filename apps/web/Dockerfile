# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# apps/web Dockerfile — DEV ONLY for PROMPT-0003.
# Runs the Vite dev server on 0.0.0.0:5173. A production build (Nginx-served
# static bundle) lands in SPEC-0040.
# Source of truth: TASKS-0003 §3.3.
# -----------------------------------------------------------------------------
ARG NODE_VERSION=22.11.0-alpine3.20
ARG PNPM_VERSION=9.15.9

FROM node:${NODE_VERSION} AS dev
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH} \
    CI=true
# Corepack shipped with older Node images carries stale integrity keys that
# reject current pnpm releases (npm/corepack#612). Upgrade Corepack first.
RUN npm install -g corepack@latest \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Workspace manifests so pnpm can resolve the dependency graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/sri-core/package.json apps/sri-core/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/logger/package.json packages/logger/
COPY packages/utils/package.json packages/utils/

RUN --mount=type=cache,id=pnpm-store-web,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @facturador/web...

# Bake the current source into the image so the container can boot without
# requiring the bind mount; docker-compose mounts apps/web/src for hot reload.
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web

# Vite writes a transient `.timestamp-*.mjs` next to vite.config.ts when
# loading the config; the runtime user must own /app.
RUN chown -R node:node /app

# Vite dev server listens here. compose mirrors the port.
EXPOSE 5173

USER node

# vite.config.ts already binds to 0.0.0.0:5173.
CMD ["pnpm", "--filter", "@facturador/web", "dev"]
