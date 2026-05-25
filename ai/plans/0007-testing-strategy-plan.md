---
id: PLAN-0007
spec: SPEC-0007
title: Testing strategy — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0007 — Testing strategy

> Implementation plan for [SPEC-0007](../specs/0007-testing-strategy.md). Cross-cutting; every later spec inherits the harness.

## 1. Goal

Stand up the canonical Vitest harness for the whole monorepo:

- Shared Vitest config in `@facturador/config/vitest`.
- Per-test Postgres schema isolation (`SCHEMA_PER_TEST` strategy) for backend tests that touch the DB.
- Supertest factory for `apps/api` and `apps/sri-core`.
- MSW for HTTP boundary mocks in web tests and any outbound HTTP from api/sri-core.
- Coverage targets enforced via `vitest --coverage` thresholds.
- A "fixtures policy" (synthetic RUCs only, no real customer data) codified.

## 2. Inputs

- [SPEC-0007](../specs/0007-testing-strategy.md) — authoritative.
- [SPEC-0004](../specs/0004-database-and-prisma.md) — prisma schema + migrations.
- [SPEC-0006](../specs/0006-error-model-and-logging.md) — logger + middlewares.

## 3. Architecture decisions

| Decision                                                                                                                                                     | Rationale                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------- |
| **One Vitest config** in `packages/config/vitest.ts` exported by name. Each app/package's `vitest.config.ts` re-exports.                                     | DRY; one place to bump thresholds.                                     |
| **Per-test schema** for DB tests: each Vitest test file gets a random schema name, runs `prisma migrate deploy` against it, runs the test, drops the schema. | Parallel-safe; no test pollution; no global truncation race.           |
| Schema lifecycle helper lives in `packages/db/src/test-harness.ts` (NEW).                                                                                    | Reusable by api and sri-core.                                          |
| **MSW v2** for HTTP mocks. Service worker setup file lives per app.                                                                                          | Industry standard; isolated from runtime.                              |
| **Supertest** for HTTP integration; `createApp()` factory in each app makes mounting easy.                                                                   | No real port binding; faster, parallel-safe.                           |
| Coverage thresholds: packages ≥ 90%, api ≥ 80%, sri-core ≥ 85%, web component coverage ≥ 70% (statement).                                                    | Reflects pure-vs-glue ratio.                                           |
| Snapshot tests **only** for HTML/JSX (web) and stable JSON shapes; never for non-deterministic data.                                                         | Prevents flake.                                                        |
| Fixture builders live under `<app                                                                                                                            | package>/test/fixtures/`. Synthetic RUCs only (start with `99999...`). | Privacy + safety. |

## 4. Phases

### Phase 1 — Shared Vitest config

1. Add devDeps to `packages/config`: `vitest@^2`, `@vitest/coverage-v8`, `@types/node`.
2. `packages/config/vitest.ts` exports a factory `defineFacturadorVitestConfig({ packageName, environment? })` that returns a Vitest config object with:
   - `test.environment: "node"` by default; `"jsdom"` opt-in for web.
   - `test.globals: true`.
   - `test.setupFiles: ["./test/setup.ts"]` (per package).
   - `test.coverage.thresholds`: configurable via parameter, but each preset has a sensible default per package class.
3. Add to `package.json` `exports`: `"./vitest"`.

### Phase 2 — Per-test schema harness

1. `packages/db/src/test-harness.ts`:
   ```ts
   export async function withTestSchema<T>(
     fn: (prisma: PrismaClient, schema: string) => Promise<T>,
   ): Promise<T>;
   ```
   - Generates a schema name like `test_${ulid().toLowerCase()}`.
   - Sets `DATABASE_URL` query parameter `?schema=...` for the spawned client.
   - Runs `npx prisma migrate deploy` (programmatically via `child_process.execFile`) against that schema URL.
   - Constructs a fresh `PrismaClient` pointed at that URL.
   - Runs `fn`, then drops the schema, disconnects.
2. A Vitest helper `useTestSchema()` for `beforeEach`/`afterEach` lifecycle that exposes `getPrisma()`.

### Phase 3 — App test setups

For `apps/api`, `apps/sri-core`:

1. `test/setup.ts`: configures the logger to a no-op stream during tests; sets `NODE_ENV=test`; seeds MSW server if outbound HTTP is expected.
2. `test/factory.ts`: exports `createTestApp({ prisma, ... })` that returns an Express app with middleware identical to production (except for `pino-pretty` logger transport).
3. `test/fixtures/`: `companyFactory`, `userFactory`, `membershipFactory`, etc. All builders return synthetic data (`9999...` RUCs).

For `apps/web`:

1. `test/setup.ts`: configures Testing Library, MSW handlers, jsdom.
2. `test/fixtures/`: API response builders matching contracts shapes.

### Phase 4 — MSW

1. `packages/config/msw.ts` exports `createServer(handlers)`. Apps add their own handlers.
2. `apps/web/test/msw/handlers.ts` covers GET `/api/v1/me`, POST `/api/v1/auth/login`, etc., with canned 200 responses.
3. `apps/api/test/msw/sri-handlers.ts` covers stubbed sri-core endpoints used by api integration tests.

### Phase 5 — CI integration

- `.github/workflows/ci.yml` runs `pnpm -r test --coverage`.
- Each project enforces its threshold; the overall run fails if any package drops below.

### Phase 6 — Forced-failure smoke

- Add a deliberate broken test in a sandbox file, confirm CI marks it red, remove.

## 5. Risks & mitigations

| Risk                                     | Mitigation                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Schema creation slow on hot loops.       | Schema-per-test-file (not per-test); ~50–100 ms overhead per file is acceptable.           |
| Parallel Postgres connections exhausted. | `--max-workers` capped via Vitest `poolOptions.threads.maxThreads`.                        |
| MSW handlers drift from real API shapes. | Handlers consume schemas from `@facturador/contracts` and assert shape before responding.  |
| Coverage thresholds gamed.               | Coverage must be measured with `--coverage` and `branches` threshold at ≥ 75% for backend. |

## 6. Validation strategy

- `pnpm -r test` exits 0 with coverage thresholds met.
- A deliberate broken test (added then removed) was observed failing CI.
- A DB integration test creates a row in its isolated schema and a parallel test does not see it.

## 7. Exit criteria

- All SPEC-0007 acceptance criteria pass.
- Vitest config is consumed by every workspace member.
- Coverage thresholds enforced in CI.

## 8. Out of scope

- E2E (Playwright) — separate optional spec.
- Performance / load testing — later.
- Mutation testing — later.
