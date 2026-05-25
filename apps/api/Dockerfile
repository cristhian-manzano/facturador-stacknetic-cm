# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# apps/api Dockerfile (multi-stage)
# Source of truth: ai/specs/0003-docker-and-local-dev.md §6.5 + TASKS-0003 §3.1.
# Stages: base -> deps -> build -> runtime.
# -----------------------------------------------------------------------------
ARG NODE_VERSION=22.11.0-alpine3.20
ARG PNPM_VERSION=9.15.9

# --- base: shared toolchain (pnpm via Corepack) ---
FROM node:${NODE_VERSION} AS base
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

# --- deps: lockfile-only install of the api workspace + its deps ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/sri-core/package.json apps/sri-core/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/logger/package.json packages/logger/
COPY packages/utils/package.json packages/utils/
RUN --mount=type=cache,id=pnpm-store-api,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @facturador/api...

# --- build: compile TypeScript ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @facturador/api... -r run build

# --- runtime: minimal image, non-root, prod deps only ---
FROM node:${NODE_VERSION} AS runtime
ARG PNPM_VERSION
ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH}
RUN npm install -g corepack@latest \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Copy lockfile + workspace manifests for a prod install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/sri-core/package.json apps/sri-core/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/logger/package.json packages/logger/
COPY packages/utils/package.json packages/utils/

RUN --mount=type=cache,id=pnpm-store-api-rt,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @facturador/api...

# Copy compiled output last so changes don't bust the deps layer.
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Drop privileges. The base node image ships a `node` user (uid 1000).
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
