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

## Documentation

The `ai/` tree holds context, ADRs, specs, plans, tasks and prompt templates:

- Context: [`ai/context/`](./ai/context/)
- Specs: [`ai/specs/`](./ai/specs/) (start at `0000-INDEX.md`)
- ADRs: [`ai/decisions/`](./ai/decisions/)

## Security

`.env` files, real certificates (`*.p12`, `*.pfx`, `*.pem`, `*.key`), and SRI
credentials MUST NOT be committed. See [`ai/context/security.md`](./ai/context/security.md).
