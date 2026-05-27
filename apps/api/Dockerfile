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
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/utils/package.json packages/utils/
COPY scripts/package.json scripts/
RUN --mount=type=cache,id=pnpm-store-api,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @facturador/api...

# --- build: compile TypeScript + generate Prisma client ---
FROM deps AS build
ARG NODE_TLS_REJECT_UNAUTHORIZED
ENV NODE_TLS_REJECT_UNAUTHORIZED=${NODE_TLS_REJECT_UNAUTHORIZED:-1}
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# Prisma client must be generated before apps/api can typecheck/build against
# the Prisma model + enum types (SriEstado, Customer, etc.) re-exported by
# @facturador/db.
RUN pnpm --filter @facturador/db exec prisma generate \
    && pnpm --filter @facturador/api... -r run build

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
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/logger/package.json packages/logger/
COPY packages/utils/package.json packages/utils/
COPY scripts/package.json scripts/

# Skip the @prisma/client postinstall in runtime — we copy the generated
# client + engines from the build stage below. Avoids a slow, network-
# dependent download of the same binaries we already produced.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN --mount=type=cache,id=pnpm-store-api-rt,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @facturador/api...

# Copy compiled output last so changes don't bust the deps layer.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/utils/dist ./packages/utils/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/logger/dist ./packages/logger/dist

# Ship the generated Prisma client + engines from the build stage so the
# runtime image does not need the `prisma` CLI (devDep stripped by --prod)
# and never has to download engine binaries at runtime. pnpm hoists
# `@prisma/client` into the virtual store under
# `node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client` — we
# copy the entire .pnpm store (which contains both `.prisma` and the
# package-local trees) so the symlinks under packages/db resolve cleanly.
COPY --from=build /app/node_modules/.pnpm ./node_modules/.pnpm

# Drop privileges. The base node image ships a `node` user (uid 1000).
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "apps/api/dist/index.js"]
