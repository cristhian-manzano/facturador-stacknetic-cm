# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# apps/sri-core Dockerfile (multi-stage)
# Source of truth: ai/specs/0003-docker-and-local-dev.md §6.5 + TASKS-0003 §3.2.
# Stages: base -> deps -> build -> runtime.
# -----------------------------------------------------------------------------
ARG NODE_VERSION=22.11.0-alpine3.20
ARG PNPM_VERSION=9.15.9

# --- base ---
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

# --- deps ---
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
RUN --mount=type=cache,id=pnpm-store-sri,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @facturador/sri-core...

# --- build ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/sri-core apps/sri-core
# Prisma client must be generated before sri-core can typecheck/build against
# the SRI* enums + model types.
RUN pnpm --filter @facturador/db prisma:generate \
    && pnpm --filter @facturador/sri-core... -r run build

# --- runtime ---
FROM node:${NODE_VERSION} AS runtime
ARG PNPM_VERSION
ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH}
RUN npm install -g corepack@latest \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

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

RUN --mount=type=cache,id=pnpm-store-sri-rt,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @facturador/sri-core... \
    && pnpm --filter @facturador/db prisma:generate

COPY --from=build /app/apps/sri-core/dist ./apps/sri-core/dist
# Schema resources travel with the build artefact so `xml/validate.js`
# can resolve the bundled XSD at runtime (TASKS-0023 §5.1). The postbuild
# step already mirrors them into `dist/resources/`, but we also ship the
# canonical copy at the package root so both relative-resolution layouts
# (src and dist) resolve to the same bytes.
COPY --from=build /app/apps/sri-core/resources ./apps/sri-core/resources
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/utils/dist ./packages/utils/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/logger/dist ./packages/logger/dist

RUN chown -R node:node /app
USER node

EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3100/healthz || exit 1
CMD ["node", "apps/sri-core/dist/index.js"]
