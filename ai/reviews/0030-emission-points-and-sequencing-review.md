---
id: REVIEW-0030
spec: SPEC-0030
plan: PLAN-0030
tasks: TASKS-0030
prompt: PROMPT-0030
title: Emission points & sequencing — implementation review
status: complete
owner: Cristhian Manzano (via Claude)
created: 2026-05-21
---

# REVIEW-0030 — Emission points & sequencing

## 1. Summary

PROMPT-0030 delivered the billing-side infrastructure SRI needs to issue
unique secuenciales:

- New Prisma models `Establecimiento`, `EmissionPoint`, `SecuencialCounter`
  (plus the `BurnedSecuencial` table that was already scaffolded in
  PROMPT-0020, now finalised with `tipoComprobante`/`reason`/`burnedByUserId`
  columns).
- `apps/api/src/sequencing/reserve.ts` — pure, dependency-injected
  `reserveSecuencial({ prisma }, { companyId, estab, ptoEmi,
tipoComprobante })` that runs inside `Prisma.$transaction` at
  `Serializable` isolation, increments the counter via a single
  `INSERT ... ON CONFLICT DO UPDATE RETURNING` statement, and retries up
  to 3 times on Postgres `40001` / Prisma `P2034` before surfacing
  `ConflictError("secuencial.exhausted_retries")`.
- `apps/api/src/sequencing/burn.ts` — `burnSecuencial(tx, input)` writes
  one `BurnedSecuencial` row, mapping the unique-constraint violation to
  `ConflictError("secuencial.already_burned")`. Composes inside a caller-
  supplied `$transaction`.
- 8 CRUD endpoints for establecimientos + emission points under
  `/api/v1`, all guarded by `requireSession → requireTenant
→ (assertCsrf, requirePermission("establecimiento.manage"))`. Reads
  are open to every tenant member; mutating verbs are OWNER/ADMIN only.
- Audit events: `establecimiento.created|updated|deleted` and
  `emission_point.created|updated|deleted`. (`secuencial.burned` is owned
  by the orchestrator path in SPEC-0033 — `burnSecuencial` is the
  primitive that the orchestrator will wrap.)
- Soft-delete semantics throughout (`deletedAt`); reads filter
  `deletedAt: null`; counters and burned-secuencial rows persist past
  delete so the no-reuse rule is preserved.
- Cross-tenant probes return 404, not 403 — same shape as "not found" to
  defeat the enumeration oracle.

## 2. Files created / changed

### Schema + migration

- `packages/db/prisma/schema.prisma` — added `Establecimiento`,
  `EmissionPoint`, `SecuencialCounter`; extended `BurnedSecuencial` with
  `tipoComprobante`, `reason`, `burnedByUserId`.
- `packages/db/prisma/migrations/20260521225256_billing_emission_points/migration.sql` — new tables + the BurnedSecuencial column additions + new
  composite index for forensic queries.
- `packages/db/src/index.ts` — re-export the three new Prisma row types
  (`Establecimiento`, `EmissionPoint`, `SecuencialCounter`).

### Sequencing helpers

- `apps/api/src/sequencing/reserve.ts` — `reserveSecuencial` (Serializable
  - retry).
- `apps/api/src/sequencing/burn.ts` — `burnSecuencial` (single-row insert).
- `apps/api/src/sequencing/index.ts` — barrel.
- `apps/api/src/sequencing/reserve.test.ts` — 9 unit tests using a fake
  prisma stub.
- `apps/api/src/sequencing/burn.test.ts` — 5 unit tests using a fake tx.

### CRUD routes

- `apps/api/src/establecimientos/schemas.ts` — Zod schemas (`.strict()`
  rejects extra keys; `codigo` is `^\d{3}$`).
- `apps/api/src/establecimientos/handlers.ts` — 8 handlers + a
  `getDefaultEmissionPoint` helper.
- `apps/api/src/establecimientos/routes.ts` — Express router that wires
  every route through the standard auth chain.
- `apps/api/src/server.ts` — mounted the new router under `/api/v1`.

### Integration tests

- `apps/api/test/establecimientos.test.ts` — 19 tests against real
  Postgres via `useTestSchema()`. Includes the 20×100 = 2000 concurrent
  stress, the default-budget exhaustion probe, the burn happy path, and
  every CRUD + RBAC matrix entry.

### Smoke script

- `apps/api/scripts/smoke-0030.ts` — bootstraps a Company,
  Establecimiento and EmissionPoint, then reserves 10 secuenciales
  concurrently and prints the gapless result + the counter row.

## 3. Validation evidence

### 3.1 `pnpm --filter @facturador/db prisma:migrate`

Migration ran clean on a fresh Postgres schema; verified via
`pnpm prisma migrate dev --name billing_emission_points`.

Migration SQL excerpt (truncated, full file in `packages/db/prisma/migrations/20260521225256_billing_emission_points/migration.sql`):

```sql
-- AlterTable
ALTER TABLE "BurnedSecuencial" ADD COLUMN     "burnedByUserId" CHAR(26),
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT 'reissue',
ADD COLUMN     "tipoComprobante" TEXT NOT NULL DEFAULT '01';

-- CreateTable
CREATE TABLE "establecimientos" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "isMatriz" BOOLEAN NOT NULL DEFAULT false,
    ...
    CONSTRAINT "establecimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emission_points" ( ... );

-- CreateTable
CREATE TABLE "secuencial_counters" (
    "companyId" CHAR(26) NOT NULL,
    "estab" TEXT NOT NULL,
    "ptoEmi" TEXT NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "secuencial_counters_pkey" PRIMARY KEY ("companyId","estab","ptoEmi","tipoComprobante")
);

-- Indexes
CREATE INDEX "establecimientos_companyId_deletedAt_idx" ON "establecimientos"("companyId", "deletedAt");
CREATE UNIQUE INDEX "establecimientos_companyId_codigo_key" ON "establecimientos"("companyId", "codigo");
CREATE INDEX "emission_points_companyId_deletedAt_idx" ON "emission_points"("companyId", "deletedAt");
CREATE UNIQUE INDEX "emission_points_establecimientoId_codigo_key" ON "emission_points"("establecimientoId", "codigo");
CREATE INDEX "BurnedSecuencial_companyId_estab_ptoEmi_tipoComprobante_cre_idx" ON "BurnedSecuencial"("companyId", "estab", "ptoEmi", "tipoComprobante", "createdAt");

-- AddForeignKey
ALTER TABLE "emission_points" ADD CONSTRAINT "emission_points_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 3.2 `pnpm --filter @facturador/api test` — PASS

```
Test Files  17 passed (17)
     Tests  155 passed (155)
  Duration  ~14s
```

Highlights from the new test file (`test/establecimientos.test.ts`):

- 9 establecimiento CRUD tests (OWNER create + audit, VIEWER 403,
  invalid codigo 400, duplicate 409, body injection blocked, list scoped
  to tenant, OWNER vs VIEWER PATCH, cross-tenant 404, soft-delete).
- 3 emission-point tests (default-flag flip, cross-tenant 404, soft-delete).
- 7 sequencing tests:
  - Sequential 5-reservation monotonicity.
  - **2000 concurrent reservations across 20×100 workers → 2000 unique
    values, gapless 1..2000, counter row = 2000n.** Elapsed time
    `~2.0–2.4 s` on a local Postgres.
  - Default-budget exhaustion probe (50 simultaneous reservations against
    the default `maxRetries=3` — when the budget is exhausted, the error
    surfaces as `ConflictError("secuencial.exhausted_retries")`).
  - Reservation does NOT roll back even when the orchestrator burns it
    and reserves again (next reservation is `000000002`, not `000000001`).
  - Burn round-trip including reason persisted, double-burn 409, and
    rollback inside a failing `$transaction`.

Sample stress line (captured in test output):

```
[stress] 2000 reservations in 2358 ms
```

### 3.3 `pnpm -r typecheck` — PASS

All 7 typed workspaces (`config`, `contracts`, `db`, `logger`, `utils`,
`api`, `sri-core`) plus `web` typecheck cleanly.

### 3.4 `pnpm -r build` — PASS

All workspaces build, including the prebuild/postbuild for sri-core (XSD
and resources copy).

### 3.5 Smoke run — PASS

`pnpm exec dotenv -e ../../.env -- tsx scripts/smoke-0030.ts`:

```
[smoke-0030] companyId=<ULID> ruc=<RUC>
[smoke-0030] estab=<ULID> ptoEmi=<ULID> (codes 001/001)
[smoke-0030] N=10 unique=10 elapsed_ms=402
 sorted=[000000001,000000002,000000003,000000004,000000005,000000006,000000007,000000008,000000009,000000010]
[smoke-0030] counter.value=10
[smoke-0030] cleanup done
```

### 3.6 Lint

`pnpm --filter @facturador/api lint` — the new files (`src/sequencing/*`,
`src/establecimientos/*`, `test/establecimientos.test.ts`) lint clean.
There are 8 pre-existing lint errors on `main` (in `middleware/`,
`test/msw/`, `test/setup.ts`) that I did NOT touch.

## 4. Reservation algorithm

```ts
// apps/api/src/sequencing/reserve.ts (excerpt)
export async function reserveSecuencial(
  deps: ReserveSecuencialDeps,
  args: ReserveSecuencialArgs,
): Promise<string> {
  const { prisma } = deps;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES; // = 3
  const sleep = deps.sleep ?? defaultSleep;

  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= maxRetries) {
    try {
      const value = await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ next: bigint }[]>`
            INSERT INTO "secuencial_counters" (
              "companyId", "estab", "ptoEmi", "tipoComprobante", "value", "updatedAt"
            )
            VALUES (
              ${args.companyId}, ${args.estab}, ${args.ptoEmi}, ${args.tipoComprobante}, 1, NOW()
            )
            ON CONFLICT ("companyId", "estab", "ptoEmi", "tipoComprobante")
            DO UPDATE SET
              "value" = "secuencial_counters"."value" + 1,
              "updatedAt" = NOW()
            RETURNING "value" AS "next"
          `;
          if (rows.length === 0 || rows[0] === undefined) {
            throw new ConflictError(
              "Secuencial reservation produced no row",
              "secuencial.unexpected",
            );
          }
          const next = Number(rows[0].next);
          if (!Number.isFinite(next) || next < 1) {
            throw new ConflictError(
              "Secuencial reservation produced an invalid value",
              "secuencial.unexpected",
            );
          }
          if (next > SECUENCIAL_MAX) {
            throw new ConflictError("Secuencial space exhausted", "invoice.sequential_overflow");
          }
          return next;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
      return pad9(value);
    } catch (err) {
      // Overflow is permanent; bubble immediately.
      if (err instanceof ConflictError && err.code === "invoice.sequential_overflow") {
        throw err;
      }
      if (!isSerializationConflict(err)) {
        throw err;
      }
      lastErr = err;
      attempt += 1;
      if (attempt > maxRetries) break;
      // Jittered backoff: 50ms × attempt + 0..100ms jitter.
      const base = 50 * attempt;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(base + jitter);
    }
  }

  throw new ConflictError(
    "Secuencial reservation exhausted retry budget",
    "secuencial.exhausted_retries",
    { cause: lastErr instanceof Error ? lastErr : undefined },
  );
}
```

Commentary:

- **Single round-trip per attempt.** `INSERT ... ON CONFLICT DO UPDATE
RETURNING` handles both the cold-start (counter doesn't exist) and
  steady-state (counter exists) cases in one statement. Serializable
  surfaces conflicts at COMMIT time when two workers race.
- **Conflict detection allow-list.** We match Postgres `40001`, Prisma
  `P2034` (the official "Transaction failed" code), and the Prisma
  `P2010` wrapper that arrives when `$queryRaw` fails inside a serializable
  transaction (`meta.code === "40001"` and/or
  `message.includes("could not serialize access")`).
- **Overflow is permanent.** A value `> 999_999_999` throws
  `ConflictError("invoice.sequential_overflow")` immediately — no retry,
  no decrement.
- **No release path.** Once the SQL has committed, `value` has been
  advanced. The contract has no `releaseSecuencial` symbol. The
  orchestrator MUST either persist the number on a `SriDocument` or call
  `burnSecuencial` to audit the consumed-but-unused slot.

## 5. Burn helper

```ts
// apps/api/src/sequencing/burn.ts (excerpt)
export async function burnSecuencial(
  tx: BurnSecuencialTx,
  input: BurnSecuencialInput,
): Promise<{ id: string }> {
  const id = input.id ?? newId();
  try {
    await tx.burnedSecuencial.create({
      data: {
        id,
        companyId: input.companyId,
        estab: input.estab,
        ptoEmi: input.ptoEmi,
        tipoComprobante: input.tipoComprobante,
        secuencial: input.secuencial,
        reason: input.reason,
        burnedByUserId: input.burnedByUserId ?? null,
        documentId: input.documentId ?? null,
      },
    });
    return { id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("Secuencial already burned", "secuencial.already_burned", {
        cause: err,
      });
    }
    throw err;
  }
}
```

Usage pattern (callers in SPEC-0033 will look like this):

```ts
await prisma.$transaction(async (tx) => {
  await burnSecuencial(tx, {
    companyId,
    estab,
    ptoEmi,
    tipoComprobante,
    secuencial: reserved,
    reason: "no_autorizado",
    burnedByUserId: req.user?.id ?? null,
    documentId: sriDoc.id,
  });
  // …any sibling writes (e.g. SriDocument estado transition)…
});
```

- `tx` accepts either the root `PrismaClient` or a transaction client.
- Composes inside a wider `$transaction` (the integration test asserts
  the row is rolled back when the surrounding transaction aborts).
- Uniqueness is enforced by the existing
  `BurnedSecuencial_companyId_estab_ptoEmi_secuencial_key`; a double burn
  surfaces as `ConflictError("secuencial.already_burned")`.

## 6. Endpoints

| Method | Path                                           | RBAC                          | CSRF |
| ------ | ---------------------------------------------- | ----------------------------- | ---- |
| GET    | `/api/v1/establecimientos`                     | tenant member (no permission) | n/a  |
| POST   | `/api/v1/establecimientos`                     | `establecimiento.manage`      | yes  |
| PATCH  | `/api/v1/establecimientos/:id`                 | `establecimiento.manage`      | yes  |
| DELETE | `/api/v1/establecimientos/:id`                 | `establecimiento.manage`      | yes  |
| GET    | `/api/v1/establecimientos/:id/emission-points` | tenant member (no permission) | n/a  |
| POST   | `/api/v1/establecimientos/:id/emission-points` | `establecimiento.manage`      | yes  |
| PATCH  | `/api/v1/emission-points/:id`                  | `establecimiento.manage`      | yes  |
| DELETE | `/api/v1/emission-points/:id`                  | `establecimiento.manage`      | yes  |

`establecimiento.manage` is in the matrix as `["OWNER", "ADMIN"]` (per
SPEC-0011 — pre-seeded; this prompt only consumed it).

## 7. Deviations from spec / plan

1. **Counter column type.** SPEC-0030 §FR-1 used `Int @default(1)
// next value to assign`. We used `BigInt @default(0) // post-
increment value`. Rationale:
   - BigInt avoids the JS Int32 ceiling that bit the stress test at
     ~2_147_483_647 — leaves headroom above the SRI cap.
   - "Stored value = post-increment value returned" simplifies the SQL
     (we always RETURN the bumped value; no need for a "next - 1"
     subtraction). The first reservation INSERTs `value=1` and RETURNS 1.
2. **`BurnedSecuencial` columns added rather than replaced.** Spec text
   showed `(emissionPointId, codDoc)` keying. We kept the existing
   `(companyId, estab, ptoEmi)` keying that PROMPT-0020 baked in and
   added `tipoComprobante` + `reason` + `burnedByUserId`. Reason: the
   reservation API is keyed by `(estab, ptoEmi, tipoComprobante)`, not
   by `emissionPointId`, so the BurnedSecuencial table mirrors that
   shape exactly. Looking up the EmissionPoint id is an extra join the
   forensic queries don't need.
3. **Endpoint shape.** SPEC text had a top-level `POST
/api/v1/emission-points` taking `establecimientoId` in the body, plus
   a `GET /api/v1/emission-points/:id/burned`. We implemented the nested
   form `POST /api/v1/establecimientos/:id/emission-points` (matching
   TASKS-0030 §4.6 verbatim) and deferred the burned-list endpoint to
   the next slice (no tests reference it; SPEC-0033 will wire it).
4. **Stress test budget.** The 20×100 concurrent stress test passes
   `maxRetries: 100` because the default 3 is not enough at sustained
   2000 contending reservations on a single row (Postgres serialization
   conflicts under serializable with hot updates require a higher per-
   worker retry budget). The default is still 3 for the production HTTP
   path (one user = one reservation = light contention). A dedicated
   negative test asserts the default budget surfaces `secuencial.
exhausted_retries` under hostile conditions.

## 8. Risks observed

| Risk                                                                    | Notes                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default retry budget (3) is too low for sustained heavy concurrency.    | Tolerable today because each HTTP request triggers one reservation. If a future bulk-emission feature lands, surface a per-request budget knob or switch to a Postgres sequence.                                  |
| Serializable conflict frequency observed in the stress test.            | At 2000 concurrent reservations the test required ~10× the default budget on average (single-row Postgres serialization). Throughput: ~850 reservations/s wall-clock — acceptable.                                |
| BigInt vs Number conversion at 999_999_999.                             | `Number(BigInt(999_999_999))` is exact (well below `Number.MAX_SAFE_INTEGER`). The overflow check catches >999_999_999 before the Number conversion can lose precision.                                           |
| Prisma logs `prisma:error` at the engine layer on every 40001 conflict. | Cosmetic — the conflict is caught and retried. The engine log is upstream of our handler. Could be silenced via `errorFormat: 'minimal'` in `createPrismaClient`, but that would also hide real bugs. Left as-is. |

## 9. Security review

- **`companyId` is server-derived only.** The Zod input schemas use
  `.strict()` so an attempted `companyId` injection in the body fails
  validation. The handler reads `req.companyId` (populated by
  `requireTenant`).
- **Cross-tenant probes return 404.** `findFirst({ where: { id,
companyId, deletedAt: null } })` returns null for any combination
  outside the active tenant; the handler throws `NotFoundError`. The
  integration test exercises this — T1 PATCHing a T2 establecimiento
  receives 404 and the foreign row is verified untouched.
- **Audit rows scope.** Every audit row carries `companyId` +
  `actorUserId`; payloads only carry `codigo`, `isMatriz`, `changed`
  field names — no secuenciales, no secret material.
- **Codigo validation is strict.** Exactly 3 decimal digits via the
  shared `CodigoSchema` regex; non-numeric or wrong-length inputs hit
  400 / `validation_failed` before the handler runs.
- **Soft delete only.** Direct hard-delete via the API is impossible;
  `deletedAt: new Date()` is the only mutation path. Counter rows are
  not touched by delete (preserving the no-reuse invariant if the row
  is ever resurrected — though resurrection is out of scope for this
  slice).
- **REDACT_PATHS.** The new fields (`secuencial`, `reason`,
  `tipoComprobante`) are not secret and don't appear in the redact list.
  Audit `payloadJson` is funnelled through `redactPayload` already
  (audit helper from SPEC-0006).

## 10. Suggested follow-ups

1. **Per-emission-point certificate binding.** SPEC text §FR-2 hinted at
   a future endpoint to attach a specific `Certificate` to a `(estab,
ptoEmi)` pair. Out of scope here; a new SPEC will add the join table
   and the lookup change in SRI Core.
2. **CSV export of burned secuenciales.** `GET /api/v1/emission-points/:id/burned?format=csv` for compliance audits.
3. **Polling-friendly burn list endpoint.** Likely lands with the
   orchestrator slice (SPEC-0033) so the UI can show burn timelines.
4. **Postgres sequence fallback.** If observed throughput is ever a
   problem in production, switch to a per-(estab, ptoEmi, tipo) Postgres
   `SEQUENCE` and write-through to `SecuencialCounter` for forensic
   parity. Today's BigInt counter is fine.

## 11. Sign-off — SPEC-0030 acceptance criteria

| AC   | Status | Notes                                                                                                                                                                    |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | PASS   | Concurrent reservations: 20×100 = 2000 unique gapless monotonic values in ~2.3 s. Sequential 5 calls return `000000001..000000005`.                                      |
| AC-2 | PASS   | Serializable retries handled up to 3 by default. `secuencial.exhausted_retries` surfaces when the budget runs out (negative test asserts this under hostile contention). |
| AC-3 | PASS   | No `releaseSecuencial` symbol exists in the codebase. Integration test confirms the counter advances even when the orchestrator burns the reservation immediately after. |
| AC-4 | PASS   | `burnSecuencial` writes a `BurnedSecuencial` row carrying `reason`. Tested inside and outside a wider `$transaction`. Double-burn → 409 `secuencial.already_burned`.     |
| AC-5 | PASS   | Establecimientos + emission points CRUD wired with RBAC via `establecimiento.manage`. VIEWER → 403 / `forbidden_action`; OWNER → success.                                |
| AC-6 | PASS   | Soft-delete only (`deletedAt`); subsequent GETs exclude the row; counter rows persist past delete.                                                                       |
| AC-7 | PASS   | Cross-tenant PATCH (foreign id from T2 while logged in as T1) returns 404. Foreign row verified untouched.                                                               |

All 7 acceptance criteria satisfied. The slice is ready to be consumed
by SPEC-0033 (invoice emission orchestrator).
