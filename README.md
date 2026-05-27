# facturador-stacknetic-cm

Multi-tenant SaaS for electronic invoicing against the Ecuadorian SRI (offline scheme).
See [`ai/specs/0000-INDEX.md`](./ai/specs/0000-INDEX.md) for the full spec roadmap.

## Stack (locked)

- pnpm workspaces monorepo, Node 22 LTS, TypeScript 5 strict ESM.
- Express 5 API + SRI Core; Vite + React 18 web; Postgres 16; Prisma 5; Zod everywhere.
- Local dev runs entirely under `docker compose` — no native Postgres install needed.

## First-time setup

1. Install Node 22 and pnpm 9 (Corepack handles the latter):

   ```sh
   corepack enable
   ```

2. Install workspace dependencies:

   ```sh
   pnpm install
   ```

3. Copy the example environment file. This is the first step every developer
   must run before bringing the stack up:

   ```sh
   cp .env.example .env
   ```

   `.env` is git-ignored. Edit it to suit your local machine. Real secrets MUST
   NOT be committed — `.env.example` only carries placeholders.

4. Bring up the full local stack (Postgres, API, SRI Core, Web):

   ```sh
   pnpm dev
   ```

   Smoke endpoints once the stack is healthy:

   - API health: <http://localhost:3000/health>
   - SRI Core health: <http://localhost:3100/health>
   - Web (Vite): <http://localhost:5173>

5. Tear down (data preserved):

   ```sh
   pnpm dev:down
   ```

   Tear down and wipe the Postgres volume:

   ```sh
   pnpm dev:reset
   ```

## Workspaces

- `apps/api` — Express 5 billing API.
- `apps/sri-core` — Express 5 SRI signer/sender (holds certificates).
- `apps/web` — Vite + React UI.
- `packages/config` — shared ESLint / TypeScript / Prettier config.
- `packages/contracts` — shared Zod schemas (`@facturador/contracts`).
- `packages/logger` — Pino logger wrapper.
- `packages/utils` — domain-agnostic helpers.

## Key environment variables

Full list lives in [`.env.example`](./.env.example). The minimum a fresh
checkout needs to boot the API + sri-core stack:

| Var                  | What it does                                                                         | Local dev default                                                                |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Postgres DSN (read by Prisma + the API).                                             | `postgresql://facturador:facturador@db:5432/facturador?schema=public`            |
| `SERVICE_JWT_SECRET` | Shared HS256 secret minted by api and verified by sri-core. ≥ 32 chars.              | `change_me_…` placeholder.                                                       |
| `MASTER_KEY_HEX`     | 64 hex chars = 32-byte AES key used to envelope-encrypt `.p12` blobs at rest.        | placeholder. Rotate with `pnpm --filter @facturador/sri-core rotate:master-key`. |
| `SRI_CORE_URL`       | API → sri-core base URL.                                                             | `http://sri-core:3100`.                                                          |
| `TRUST_PROXY_HOPS`   | Express `trust proxy` value when sitting behind nginx/ALB.                           | `loopback`.                                                                      |
| `NODE_ENV`           | `development` / `test` / `production`. Drives env-loader strictness + HSTS emission. | `development`.                                                                   |

## Daily commands

| Command                  | What it does                                                           |
| ------------------------ | ---------------------------------------------------------------------- |
| `pnpm dev`               | Bring up the full local stack via `docker compose`.                    |
| `pnpm typecheck`         | Per-workspace `tsc --noEmit`.                                          |
| `pnpm typecheck:project` | `tsc --build` across the project references (faster incremental).      |
| `pnpm lint`              | ESLint flat config — includes the custom `@facturador/security` rules. |
| `pnpm test`              | Vitest across all workspaces.                                          |
| `pnpm -r test:coverage`  | Same but enforces per-workspace coverage thresholds.                   |
| `pnpm build`             | Per-workspace TS build (used in CI + the dockerfiles).                 |
| `pnpm db:psql`           | Open a `psql` shell against the dev Postgres container.                |

## Operator scripts (apps/sri-core)

| Script                                                                                                  | What it does                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/sri-core rotate:master-key`                                                  | Re-encrypts every certificate envelope from `OLD_MASTER_KEY_HEX` to `NEW_MASTER_KEY_HEX`. Idempotent via `kmsKeyVersion`. |
| `pnpm --filter @facturador/sri-core clave-acceso -- --ruc … --estab … --pto … --secuencial … --tipo 01` | Prints the 49-digit `claveAcceso` for a tuple — useful for smoke-testing SRI calls by hand.                               |
| `pnpm --filter @facturador/sri-core smoke:sri`                                                          | End-to-end SRI emit/poll dry-run against a stub or real SRI environment.                                                  |

## Production checklist

Before promoting a build to production, walk through these reviews — they
codify the contracts each layer is expected to honour and the operational
guards that must be in place:

- Final cross-cutting review: [`ai/reviews/0044-final-full-project-review.md`](./ai/reviews/0044-final-full-project-review.md)
- Auth + RBAC (cookies, CSRF, session sweep): [`0009-auth-baseline-review.md`](./ai/reviews/0009-auth-baseline-review.md), [`0010-tenants-and-rbac-review.md`](./ai/reviews/0010-tenants-and-rbac-review.md)
- Certificates + envelope encryption + rotation: [`0020-sri-core-and-service-jwt-review.md`](./ai/reviews/0020-sri-core-and-service-jwt-review.md), [`0021-certificates-and-encryption-review.md`](./ai/reviews/0021-certificates-and-encryption-review.md)
- SRI lifecycle (emit / poll / authorise): [`0025-sri-soap-clients-review.md`](./ai/reviews/0025-sri-soap-clients-review.md), [`0026-document-lifecycle-and-jobs-review.md`](./ai/reviews/0026-document-lifecycle-and-jobs-review.md)
- Invoice pipeline (compute / emit / orchestrator): [`0032-invoice-domain-review.md`](./ai/reviews/0032-invoice-domain-review.md), [`0033-invoice-emission-orchestrator-review.md`](./ai/reviews/0033-invoice-emission-orchestrator-review.md)
- Web app bootstrap + invoice UI: [`0040-web-app-bootstrap-review.md`](./ai/reviews/0040-web-app-bootstrap-review.md), [`0042-web-invoice-create-review.md`](./ai/reviews/0042-web-invoice-create-review.md), [`0043-web-invoice-list-and-detail-review.md`](./ai/reviews/0043-web-invoice-list-and-detail-review.md)
- Logging + redaction + audit trail: [`0006-error-model-and-logging-review.md`](./ai/reviews/0006-error-model-and-logging-review.md)

## Documentation

The `ai/` tree holds context, ADRs, specs, plans, tasks and prompt templates:

- Context: [`ai/context/`](./ai/context/)
- Specs: [`ai/specs/`](./ai/specs/) (start at `0000-INDEX.md`)
- ADRs: [`ai/decisions/`](./ai/decisions/)

## Security

`.env` files, real certificates (`*.p12`, `*.pfx`, `*.pem`, `*.key`), and SRI
credentials MUST NOT be committed. See [`ai/context/security.md`](./ai/context/security.md).
