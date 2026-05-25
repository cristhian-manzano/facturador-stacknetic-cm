---
id: SPEC-0007
title: Testing strategy
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002, SPEC-0003, SPEC-0004]
blocks: []
---

# SPEC-0007 — Testing strategy

## 1. Purpose

Lock the testing approach so each subsequent spec can simply state "tests follow SPEC-0007" instead of redefining patterns. Goal: enough automated coverage to ship a fiscal product with confidence, without slowing engineering.

## 2. Scope

### 2.1 In scope

- Test pyramid policy (unit > integration > e2e).
- Vitest layout, conventions, naming.
- Database integration tests: per-test schema isolation.
- HTTP integration tests: Supertest against the actual Express app.
- Web component tests: Vitest + Testing Library.
- E2E (smoke level) for the **golden path**: login → create factura → AUTORIZADO. Implemented with Playwright in a later spec, but the contract is set here.
- Fixtures policy.
- Coverage thresholds.
- Custom ESLint rule that enforces tenant filter in repos (referenced from [SPEC-0004](./0004-database-and-prisma.md)).

### 2.2 Out of scope

- Performance / load testing (later).
- Security/penetration testing (later).
- Production smoke probes (handled by `/healthz`).

## 3. Context & references

- [SPEC-0002](./0002-shared-tooling.md) — `vitest.base.ts`.
- [SPEC-0004](./0004-database-and-prisma.md) — DB workflow.
- [SPEC-0006](./0006-error-model-and-logging.md) — logger, errors.
- Vitest docs: https://vitest.dev/
- Testing Library: https://testing-library.com/

## 4. Functional requirements

- **FR-1.** Three test tiers, all with `*.test.ts(x)` extension:
  - **Unit** — colocated next to source, no I/O, < 50 ms each.
  - **Integration** — under `apps/<app>/test/integration/`, talk to real Postgres and real Express; mock only external systems (SRI SOAP).
  - **E2E** — under `apps/web/test/e2e/`, Playwright-driven, run the full stack via docker-compose.
- **FR-2.** Coverage targets:
  - `packages/*`: ≥ 90% lines.
  - `apps/api`: ≥ 80% lines, ≥ 75% branches.
  - `apps/sri-core`: ≥ 85% lines (XML/signing logic is critical).
  - `apps/web`: ≥ 70% lines.
- **FR-3.** Every PR runs unit + integration tests in CI (CI spec later); E2E runs on nightly + on `release/*` branches.
- **FR-4.** Integration tests use a **dedicated** Postgres schema per worker, dropped after the run. No shared mutable state.
- **FR-5.** Network calls to SRI are **never** made by tests. SOAP responses are served from fixtures (`apps/sri-core/test/fixtures/sri-responses/`).

## 5. Non-functional requirements

- **NFR-1.** `pnpm test` on a clean checkout: unit tests for the full workspace ≤ 60 s.
- **NFR-2.** `pnpm test:integration` ≤ 5 min locally.
- **NFR-3.** Tests must be deterministic. No flakiness budget — flaky tests are bugs.

## 6. Technical design

### 6.1 Layout (per app)

```
apps/api/
├── src/
│   ├── feature-x/
│   │   ├── service.ts
│   │   └── service.test.ts        # UNIT, colocated
│   └── ...
└── test/
    ├── helpers/
    │   ├── db.ts                  # createTestSchema(), dropTestSchema()
    │   ├── app.ts                 # buildApp() for supertest
    │   └── fixtures/              # JSON / TS factories
    └── integration/
        ├── auth.login.test.ts
        ├── invoices.create.test.ts
        └── ...
```

### 6.2 Vitest configuration per app

`apps/api/vitest.config.ts`:

```ts
import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "@facturador/config/vitest.base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "test/integration/**/*.test.ts"],
      setupFiles: ["test/helpers/setup.ts"],
      pool: "forks",
      poolOptions: { forks: { singleFork: false } },
    },
  }),
);
```

### 6.3 Per-test Postgres schema

```ts
// apps/api/test/helpers/db.ts
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface TestDb {
  prisma: PrismaClient;
  schema: string;
  dispose: () => Promise<void>;
}

export const createTestDb = (): TestDb => {
  const schema = `test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", schema);
  const databaseUrl = url.toString();

  execSync(`DATABASE_URL=${databaseUrl} pnpm --filter @facturador/api prisma migrate deploy`, {
    stdio: "ignore",
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return {
    prisma,
    schema,
    dispose: async () => {
      await prisma.$disconnect();
      const admin = new PrismaClient();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    },
  };
};
```

Use it per test file:

```ts
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

describe("auth login", () => {
  let db: TestDb;
  beforeAll(() => {
    db = createTestDb();
  });
  afterAll(async () => {
    await db.dispose();
  });

  it("succeeds with valid credentials", async () => {
    // seed minimal, exercise app via supertest, assert
  });
});
```

### 6.4 `buildApp()` helper

```ts
// apps/api/test/helpers/app.ts
import { createApp } from "../../src/app.js";
import type { PrismaClient } from "@prisma/client";

export const buildApp = (prisma: PrismaClient) =>
  createApp({ prisma, sriCore: fakeSriCoreClient() });

const fakeSriCoreClient = () => ({
  emitDocument: async (_req: unknown) => ({
    /* canned response */
  }),
});
```

Each app exports a `createApp(deps)` factory so tests inject fakes (DB, SRI Core client, logger).

### 6.5 SRI fixture policy (relevant to SRI Core)

- All SRI request/response fixtures live in `apps/sri-core/test/fixtures/sri-responses/`.
- Naming: `recepcion.RECIBIDA.xml`, `recepcion.DEVUELTA.errores.xml`, `autorizacion.AUTORIZADO.xml`, `autorizacion.EN_PROCESO.xml`, etc.
- Real RUCs anonymised; use **only** SRI-published test RUCs (e.g. `1790012345001` is a known test ID).
- A "golden file" XML for a signed factura is stored under `golden/factura.signed.xml` and used in snapshot tests.

### 6.6 Mocking SRI's SOAP layer

`apps/sri-core/test/helpers/sri-soap-stub.ts` provides an in-process replacement for the SOAP client:

```ts
export const stubSriSoap = (responses: { recepcion?: string; autorizacion?: string }) => ({
  sendRecepcion: async () => responses.recepcion ?? defaultRecepcionRecibida,
  consultarAutorizacion: async () => responses.autorizacion ?? defaultAutorizacionAutorizado,
});
```

### 6.7 Web component tests

`apps/web/vitest.config.ts` uses environment `jsdom`. Component tests use `@testing-library/react` and `@testing-library/user-event`. No snapshot tests for UI (brittle).

### 6.8 Custom ESLint rule — `enforce-tenant-filter` (high-value, low-cost)

Reference implementation (sketch) in `packages/config/eslint-rules/enforce-tenant-filter.js`:

- Triggers on `CallExpression` matching `prisma.<modelName>.<method>` where `modelName` is in a configured list of tenant-scoped models (loaded from `prisma/schema.prisma`).
- Walks the first argument `{ where: ... }` and asserts `companyId` appears as a key.
- Whitelisted methods: `findUnique` (uses unique key), and queries in files under `apps/api/src/db/raw/` (must include `// eslint-disable-line enforce-tenant-filter` with justification).

A simpler stopgap until the custom rule exists: a grep-based check in CI (`scripts/check-tenant-filter.sh`).

### 6.9 E2E (Playwright) — skeleton only

Path: `apps/web/test/e2e/`. Spec is created later when Web is implemented; this spec only **commits to** the golden path being covered:

```
Scenario: User logs in and emits a factura
  Given a seeded demo tenant with a valid certificate
  And the test SRI SOAP server returns AUTORIZADO
  When the user logs in as admin@demo.local
  And navigates to "New invoice"
  And fills the form with a single line for $100, IVA 15%
  And submits
  Then the invoice list shows status AUTORIZADO within 10s
```

## 7. Implementation guide

### 7.1 Steps (when this spec is implemented)

1. Add `vitest.config.ts` per app and per package using `@facturador/config/vitest.base`.
2. Add `apps/api/test/helpers/db.ts`, `app.ts`, `setup.ts`.
3. Create stub SRI SOAP helper in SRI Core.
4. Add `pnpm test`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:coverage` scripts.
5. Document the workflow in the root `README.md`.

### 7.2 Dependencies

| Workspace         | Package                       | Version   | Purpose           |
| ----------------- | ----------------------------- | --------- | ----------------- |
| Root devDep       | `vitest`                      | `^2.1.0`  | Test runner.      |
| `apps/api` devDep | `supertest`                   | `^7.0.0`  | HTTP integration. |
| `apps/api` devDep | `@types/supertest`            | `^6.0.2`  | Types.            |
| `apps/web` devDep | `@testing-library/react`      | `^16.0.0` | Component tests.  |
| `apps/web` devDep | `@testing-library/user-event` | `^14.5.2` | Interactions.     |
| `apps/web` devDep | `jsdom`                       | `^25.0.0` | DOM env.          |
| Future (E2E spec) | `@playwright/test`            | latest    | Playwright.       |

### 7.3 Conventions

- One `describe` per file; `it` blocks describe behaviour ("returns 400 when ...").
- No shared mutable fixtures across files.
- Use **factory functions** for fixtures: `makeUser({ email: "x@y" })`.
- Async tests must `await` everything. No `setImmediate` / `setTimeout` hacks.
- Test data Spanish field names must match production (`razonSocial`, not `legalName`).

## 8. Acceptance criteria

- **AC-1.** `pnpm test` runs and passes on a fresh checkout once the relevant code lands.
- **AC-2.** `pnpm test:coverage` reports per-workspace coverage and fails the build if thresholds (§5.NFR-1, FR-2) are not met.
- **AC-3.** An integration test that creates a `User` in schema A does not see that user from a parallel test in schema B.
- **AC-4.** A test that triggers `prisma.invoice.findMany({ where: {} })` is rejected by the tenant-filter ESLint rule (or the grep stopgap).
- **AC-5.** The fake SRI Core SOAP stub returns a known-good `AUTORIZADO` fixture by default; tests that override it do so explicitly.

## 9. Test plan

(Meta — this spec **is** the test plan. Implementation lands incrementally with each downstream spec.)

## 10. Security considerations

- Fixtures **must** use synthetic RUCs and synthetic customer data. Reviewer rejects any fixture suspected of being real.
- The test schema isolation prevents cross-test data leakage.
- E2E test environment uses a sandbox certificate; never a production `.p12`.

## 11. Observability

Not applicable.

## 12. Risks and mitigations

| Risk                                   | Mitigation                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Integration suite becomes slow         | Parallel forks; index hot queries; budget reviews.                                                     |
| Flaky tests from time-based assertions | Inject a `clock` in services (no `new Date()` deep in code).                                           |
| Tenant-filter rule has false positives | Custom rule supports `// eslint-disable-line enforce-tenant-filter -- reason` with a mandatory reason. |

## 13. Open questions

- Should we adopt mutation testing (Stryker) on `apps/sri-core` later? Possibly. The XML builder + signer benefits the most. Defer.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
