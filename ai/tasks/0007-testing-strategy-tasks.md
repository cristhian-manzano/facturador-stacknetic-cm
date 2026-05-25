---
id: TASKS-0007
spec: SPEC-0007
plan: PLAN-0007
title: Testing strategy — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0007 — Testing strategy

> Checklist for [SPEC-0007](../specs/0007-testing-strategy.md) + [PLAN-0007](../plans/0007-testing-strategy-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No real customer data in fixtures. Every RUC starts with `9999...`. Every email ends in `@facturador.test`.
- ❌ No real network calls in tests (MSW or stubs only).
- ❌ Coverage thresholds never reduced to make a build pass.
- ✅ Per-test-file Postgres schema isolation is mandatory for any DB integration test.
- ✅ A test that "passes" without exercising code (no assertion, no actual DB hit) is a bug; treat as failing.

## 1. Shared Vitest config

- [ ] **1.1** Add devDeps to `packages/config`: `vitest@^2`, `@vitest/coverage-v8`, `msw@^2`.
      **Validate**: `pnpm --filter @facturador/config exec vitest --version` prints v2.

- [ ] **1.2** Create `packages/config/vitest.ts` exporting `defineFacturadorVitestConfig({ packageName, environment?, coverageThresholds? })`:

  ```ts
  export const defineFacturadorVitestConfig = ({
    packageName,
    environment = "node",
    coverageThresholds,
  }) =>
    defineConfig({
      test: {
        name: packageName,
        environment,
        globals: true,
        setupFiles: ["./test/setup.ts"],
        coverage: {
          provider: "v8",
          reporter: ["text", "lcov", "html"],
          include: ["src/**"],
          thresholds: coverageThresholds ?? defaultsFor(packageName),
        },
        poolOptions: { threads: { singleThread: false, maxThreads: 4 } },
      },
    });
  ```

  **Validate**: `node -e "import('@facturador/config/vitest').then(m=>console.log(typeof m.defineFacturadorVitestConfig))"` prints `function`.

- [ ] **1.3** Add `"./vitest"` to `packages/config/package.json` exports.
      **Validate**: subpath resolves.

## 2. Per-test schema harness

- [ ] **2.1** Create `packages/db/src/test-harness.ts` exposing:

  - `createTestSchema()`: returns `{ schema: string, prisma: PrismaClient, url: string }`.
  - `dropTestSchema({ schema, prisma })`.
  - `useTestSchema()`: Vitest-style `beforeEach`/`afterEach` exposing `getPrisma()`.
  - Internally: builds a unique schema name (`test_${ulid().toLowerCase()}`), spawns `prisma migrate deploy` with the schema-scoped DATABASE_URL, returns a client pinned to it.
    **Validate**: a unit-style integration test creates two schemas in parallel, inserts a Company in each, asserts cross-schema isolation (count = 1 in each).

- [ ] **2.2** Export the harness via `@facturador/db/test-harness` subpath.
      **Validate**: import works in `apps/api/test/...`.

## 3. Per-app setup files

- [ ] **3.1** `apps/api/vitest.config.ts`:

  ```ts
  import { defineFacturadorVitestConfig } from "@facturador/config/vitest";
  export default defineFacturadorVitestConfig({
    packageName: "@facturador/api",
    environment: "node",
  });
  ```

  **Validate**: `pnpm --filter @facturador/api test` runs (even if no tests yet — exit 0 with "no tests found" is acceptable until tests exist).

- [ ] **3.2** Same for `apps/sri-core/vitest.config.ts`.
      **Validate**: same.

- [ ] **3.3** `apps/web/vitest.config.ts` uses `environment: "jsdom"` and includes Testing Library setup.
      **Validate**: a smoke test importing `@testing-library/react` and rendering `<div>Hello</div>` passes.

- [ ] **3.4** Each app has `test/setup.ts`:

  - Sets `NODE_ENV=test`.
  - Replaces the logger transport with a writable stream collector (so tests can assert log lines without polluting stdout).
  - Web variants additionally call `expect.extend(matchers)` from `@testing-library/jest-dom`.
    **Validate**: setup file is loaded (add a `console.error("loaded")` temporarily, confirm via output, remove).

- [ ] **3.5** Each app has `test/factory.ts` exporting `createTestApp(deps)` returning an Express app wired identically to `src/server.ts`.
      **Validate**: a Supertest test using `createTestApp({ prisma })` hits `/health` and `/health-db` and receives 200.

## 4. MSW

- [ ] **4.1** Create `apps/web/test/msw/server.ts` initialising `setupServer(...handlers)`.
      **Validate**: `pnpm --filter @facturador/web test` runs without "unhandled request" warnings on a smoke test that fetches `/api/v1/me`.

- [ ] **4.2** Create `apps/web/test/msw/handlers.ts` exporting handlers for `/api/v1/me` (200 with synthetic user), `/api/v1/auth/login` (200), `/api/v1/auth/logout` (204).
      Each handler validates its response shape against the corresponding Zod schema from `@facturador/contracts/auth` (`MeResponseSchema.parse(...)`).
      **Validate**: handler-level test asserts shape.

- [ ] **4.3** For api: create `apps/api/test/msw/sri-handlers.ts` with stubs for sri-core's `/v1/documents/emit`, `/v1/documents/:claveAcceso/status`. Validate against `@facturador/contracts/sri`.
      **Validate**: api integration test using MSW server hits the stubs through fetch and receives expected shape.

## 5. Fixtures policy

- [ ] **5.1** Create `apps/api/test/fixtures/company.ts` with `companyFactory({ overrides? })` returning a valid Company with `ruc` starting `9999`.
      **Validate**: `companyFactory().ruc.startsWith("9999")` and `RucSchema.parse(...)` succeeds.

- [ ] **5.2** Same pattern for `user.ts`, `membership.ts`, `session.ts`, `auditLog.ts`.
      **Validate**: each fixture builder's output parses with the corresponding Zod schema from contracts.

- [ ] **5.3** Add `apps/api/test/fixtures/README.md` documenting:
  - Use `9999*` RUCs only.
  - Emails end in `@facturador.test`.
  - Never include real client names or claves de acceso.
    **Validate**: file exists.

## 6. Coverage thresholds

- [ ] **6.1** Set per-package thresholds:
  - `packages/contracts`, `packages/utils`, `packages/logger`, `packages/db`: statements ≥ 90, branches ≥ 80.
  - `apps/api`: statements ≥ 80, branches ≥ 70.
  - `apps/sri-core`: statements ≥ 85, branches ≥ 75.
  - `apps/web`: statements ≥ 70, branches ≥ 60.
    **Validate**: `pnpm -r test --coverage` exits 0 with the current minimal codebase (placeholders + smoke tests should comfortably exceed thresholds because they cover ≥ 90% of trivial code).

## 7. CI

- [ ] **7.1** Update `.github/workflows/ci.yml` to add `test` job running `pnpm -r test --coverage` after `lint` and `typecheck`.
      **Validate**: `actionlint .github/workflows/ci.yml` exits 0.

## 8. Forced-failure smoke

- [ ] **8.1** Add a deliberate failing test in `apps/api/test/smoke-broken.test.ts` (`expect(true).toBe(false)`).
      **Validate**: `pnpm --filter @facturador/api test` exits non-zero.
      Then DELETE the file.
      **Re-validate**: subsequent `pnpm --filter @facturador/api test` exits 0.

## 9. Acceptance criteria

- [ ] AC-1: Shared Vitest config consumed by every workspace member.
- [ ] AC-2: DB tests run in isolated schemas; cross-schema pollution proven absent.
- [ ] AC-3: MSW handlers validate responses against contracts.
- [ ] AC-4: Coverage thresholds enforced and met.
- [ ] AC-5: Fixtures only use synthetic identifiers.
- [ ] AC-6: A deliberately broken test fails the build; once removed, the build is green.
- [ ] AC-7: CI workflow file passes actionlint.

## 10. Definition of Done

- All boxes ticked.
- `pnpm -r test --coverage` green with thresholds met.
- Review file `ai/reviews/0007-testing-strategy-review.md` written.
