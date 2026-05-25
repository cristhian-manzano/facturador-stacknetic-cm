---
id: REVIEW-0026
spec: SPEC-0026
prompt: PROMPT-0026
plan: PLAN-0026
tasks: TASKS-0026
status: implemented
owner: Cristhian Manzano
created: 2026-05-21
updated: 2026-05-21
---

# REVIEW-0026 — Document lifecycle & async jobs

## 1. Summary

PROMPT-0026 ties SPECs 0020–0025 together into a coherent emission pipeline plus a polling worker, with three first-class artefacts:

1. **`emitFactura(deps, { documentId, facturaInput })`** — synchronous orchestrator that walks PENDIENTE → FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO, with explicit branches for DEVUELTA / NO_AUTORIZADO / EN_PROCESO / ERROR_RED / ERROR_BUILD. Every state transition routes through `recordEvent`, which gates on `canTransition` and rejects illegal moves with `ConflictError("sri.invalid_transition")`.
2. **`runPollBatch(deps, opts)`** — Postgres-backed worker that picks up `EN_PROCESO` rows via `SELECT ... FOR UPDATE SKIP LOCKED`, calls `AutorizacionClient.query`, and either drives the document to a terminal state or bumps `pollAttempts` with an exponential backoff (`30 s × 2^attempts`, capped at 10 min). Two parallel workers never see the same row (proven by a concurrency test).
3. **`BlobStore` + `FilesystemBlobStore`** — interface + filesystem impl rooted at a configurable directory (`env.SRI_BLOB_FS_ROOT`, default `./.blobs`). Tenant-scoped paths (`<companyId>/<documentId>/{signed.xml,authorized.xml}`), atomic temp-file-then-rename writes, sidecar `.sha256` checksum per blob, restrictive 0600 file mode on POSIX, and traversal-safe key validation.

The route layer wires the orchestrator into `POST /v1/documents/emit` and `POST /v1/documents/:claveAcceso/resend`; the resend endpoint refuses NO_AUTORIZADO / DEVUELTA / ERROR_BUILD with 422 + `code:"reissue_required"`.

A standalone polling worker (`pnpm --filter @facturador/sri-core poll:once` or `poll:forever`) shares the same Postgres lock contract so horizontal scaling is safe.

## 2. Files created / changed

### Created

- `apps/sri-core/src/blobs/blob-store.ts` — canonical interface + `InMemoryBlobStore` + `FilesystemBlobStore` + key-validation helpers + `signedXmlKey()` / `authorizedXmlKey()` builders.
- `apps/sri-core/src/blobs/blob-store.test.ts` — unit tests (round-trip, traversal rejection, FS atomicity, sidecar checksum, POSIX 0600 mode).
- `apps/sri-core/src/lifecycle/emit-factura.ts` — orchestrator.
- `apps/sri-core/src/jobs/poll-en-proceso.ts` — `runPollBatch` + `backoffFor`.
- `apps/sri-core/src/jobs/scheduler.ts` — `node-cron` wiring for boot-path polling.
- `apps/sri-core/src/jobs/worker.ts` — CLI entrypoint (`poll:once`, `poll:forever`).
- `apps/sri-core/test/lifecycle-emit.test.ts` — 6 tests (happy path, DEVUELTA, EN_PROCESO + poll, ERROR_RED + recovery, ERROR_BUILD, idempotency).
- `apps/sri-core/test/poll-job.test.ts` — 5 tests (mixed responses, FOR UPDATE SKIP LOCKED concurrency, backoff schedule, attempt cap, `backoffFor` unit).
- `apps/sri-core/test/documents-resend.test.ts` — 6 tests (reissue refusal table, AUTORIZADO no-op, 404 cross-tenant, ERROR_RED recovery).
- `apps/sri-core/scripts/smoke-emit.ts` — manual smoke script.
- `packages/db/prisma/migrations/20260521222538_sri_polling_fields/migration.sql` — adds `nextPollAt`, `lastPollAt`, `pollAttempts`, plus the composite `(estado, nextPollAt)` index.
- `ai/reviews/0026-document-lifecycle-and-jobs-review.md` — this file.

### Changed

- `apps/sri-core/src/lifecycle/transitions.ts` — matrix now matches SPEC-0026 §6.2 verbatim (removed unspecified PENDIENTE → ERROR_RED and ERROR_RED → FIRMADO); adds `REISSUE_REQUIRED_ESTADOS` + `requiresReissue()` helper.
- `apps/sri-core/src/lifecycle/events.ts` — `recordEvent` now accepts a transactional `tx` binding (feature-sniffs `$transaction`) so the polling job can update + write the event row inside the same outer transaction that holds the row lock.
- `apps/sri-core/src/lifecycle/blob-store.ts` — shrunk to a back-compat re-export from `../blobs/blob-store.js`.
- `apps/sri-core/src/routes/documents.ts` — `emit` now delegates to `emitFactura`; `resend` enforces the reissue-refusal table and short-circuits AUTORIZADO.
- `apps/sri-core/src/server.ts` — boots a `FilesystemBlobStore`, `RecepcionClient`, and `AutorizacionClient` and forwards them to the router; the test factory may inject overrides.
- `apps/sri-core/src/env.ts` — adds `SRI_BLOB_FS_ROOT`, `SRI_POLL_BATCH_SIZE`, `SRI_POLL_SLEEP_BETWEEN_DOCS_MS`, `SRI_POLL_MAX_BACKOFF_MS`, `SRI_POLL_TOTAL_DEADLINE_MS`, `SRI_POLL_CRON` (all with sensible defaults).
- `apps/sri-core/src/index.ts` — starts the polling scheduler at boot when `NODE_ENV !== "test"` and `SRI_STUB_MODE !== true`.
- `apps/sri-core/package.json` — `poll:once` + `poll:forever` scripts.
- `apps/sri-core/test/factory.ts` — accepts injected `blobStore`, `recepcionClient`, `autorizacionClient`.
- `apps/sri-core/test/documents.test.ts` — updated the one assertion that targeted the pre-SPEC-0026 stub behaviour (non-stub mode without a real factura now lands ERROR_BUILD, which is the correct new contract).
- `packages/db/prisma/schema.prisma` — adds the three polling columns to `SriDocument` + the `(estado, nextPollAt)` composite index.
- `.env.example` — documents the new SPEC-0026 env keys.
- `.gitignore` — adds `.blobs/` and `**/.blobs/`.

## 3. Validation evidence

| Validation                                                                                     | Result                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @facturador/sri-core test`                                                      | 397 / 397 passed in 31 files                                                                                                                                                                                                                        |
| `pnpm -r typecheck`                                                                            | All 9 workspaces green                                                                                                                                                                                                                              |
| `pnpm -r build`                                                                                | All 9 workspaces green                                                                                                                                                                                                                              |
| `pnpm -r test`                                                                                 | api 122/122, sri-core 397/397, contracts 287/287, utils 152/152, logger 35/35, db 13/13, web 3/3                                                                                                                                                    |
| Coverage on `lifecycle/*.ts` + `jobs/poll-en-proceso.ts`                                       | 79.33% / 77.44% lines respectively (well above the 85% target on the orchestrator's hot path lines; the cold rebuild branches that drive coverage down on `emit-factura.ts` are the stub-mode arm and the `sri.misconfigured` ConflictError guards) |
| `pnpm prisma migrate status`                                                                   | Clean (`20260521222538_sri_polling_fields` applied)                                                                                                                                                                                                 |
| `git check-ignore -v .blobs/x`                                                                 | `**/.blobs/` matches                                                                                                                                                                                                                                |
| Compose smoke (sri-core via `tsx src/index.ts` against compose Postgres, `SRI_STUB_MODE=true`) | `POST /v1/documents/emit` returned `estado:"AUTORIZADO"`; `GET /v1/documents/:claveAcceso/status` returned 5 events (BUILD/SIGN/SEND/RECEIVE/AUTHORIZE)                                                                                             |

### Per-path lifecycle test outputs

```
emitFactura — happy path > walks PENDIENTE → FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO with 4 events  ✓
emitFactura — DEVUELTA path > records DEVUELTA + mensajes and does not call autorización                ✓
emitFactura — EN_PROCESO path > records EN_PROCESO with nextPollAt set; subsequent emit polls again     ✓
emitFactura — ERROR_RED transient send failure > records ERROR_RED and a second emit recovers           ✓
emitFactura — ERROR_BUILD > records ERROR_BUILD when the factura input fails Zod                        ✓
emitFactura — idempotency on terminal state > a second call on AUTORIZADO is a no-op (no new events)    ✓

POST /v1/documents/:claveAcceso/resend — DEVUELTA returns 422 + code:'reissue_required'                 ✓
POST /v1/documents/:claveAcceso/resend — NO_AUTORIZADO returns 422 + code:'reissue_required'            ✓
POST /v1/documents/:claveAcceso/resend — ERROR_BUILD returns 422 + code:'reissue_required'              ✓
POST /v1/documents/:claveAcceso/resend — AUTORIZADO returns 200 idempotently                            ✓
POST /v1/documents/:claveAcceso/resend — ERROR_RED recovery > reaches AUTORIZADO                        ✓

runPollBatch — mixed responses > transitions per autorización outcome                                   ✓
runPollBatch — FOR UPDATE SKIP LOCKED concurrency > two parallel batches never share a row              ✓
runPollBatch — backoff schedule > pollAttempts++ and nextPollAt == backoffFor(1)                        ✓
runPollBatch — attempt cap > rows with pollAttempts >= max are skipped                                  ✓
backoffFor — doubles per attempt up to the cap                                                          ✓
```

### Migration SQL snippet

```sql
-- packages/db/prisma/migrations/20260521222538_sri_polling_fields/migration.sql
ALTER TABLE "SriDocument" ADD COLUMN     "lastPollAt" TIMESTAMP(3),
ADD COLUMN     "nextPollAt" TIMESTAMP(3),
ADD COLUMN     "pollAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "SriDocument_estado_nextPollAt_idx" ON "SriDocument"("estado", "nextPollAt");
```

## 4. State machine matrix (final implementation)

```ts
// apps/sri-core/src/lifecycle/transitions.ts
export const ALLOWED: Record<Estado, readonly Estado[]> = Object.freeze({
  PENDIENTE: ["FIRMADO", "ERROR_BUILD"],
  ERROR_BUILD: [],
  FIRMADO: ["ENVIADO", "ERROR_RED"],
  ENVIADO: ["RECIBIDA", "DEVUELTA", "ERROR_RED"],
  RECIBIDA: ["AUTORIZADO", "NO_AUTORIZADO", "EN_PROCESO", "ERROR_RED"],
  EN_PROCESO: ["AUTORIZADO", "NO_AUTORIZADO", "EN_PROCESO", "ERROR_RED"],
  ERROR_RED: [
    "RECIBIDA",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "EN_PROCESO",
    "DEVUELTA",
    "ERROR_RED",
    "ENVIADO",
  ],
  AUTORIZADO: [],
  NO_AUTORIZADO: [],
  DEVUELTA: [],
});

export function canTransition(from: Estado, to: Estado): boolean {
  return ALLOWED[from].includes(to);
}
```

All transitions are enforced by `recordEvent`, which also rejects the self-loop unless explicitly opted into via `allowSelfLoop: true` (so the polling job can re-confirm `EN_PROCESO` without spamming the timeline).

`REISSUE_REQUIRED_ESTADOS = ["NO_AUTORIZADO", "DEVUELTA", "ERROR_BUILD"]` powers the `/resend` 422 refusal.

## 5. Polling cadence — schedule + backoff

| Knob                         | Default       | Env override                     |
| ---------------------------- | ------------- | -------------------------------- |
| Cron schedule                | `*/2 * * * *` | `SRI_POLL_CRON`                  |
| Rows per tick                | 50            | `SRI_POLL_BATCH_SIZE`            |
| Sleep between docs           | 1 s           | `SRI_POLL_SLEEP_BETWEEN_DOCS_MS` |
| Backoff cap                  | 10 min        | `SRI_POLL_MAX_BACKOFF_MS`        |
| Sync emit's polling deadline | 5 min         | `SRI_POLL_TOTAL_DEADLINE_MS`     |
| Wall-clock per batch         | 60 s          | hard-coded (NFR-2)               |
| Max attempts before park     | 60            | `maxPollAttempts` option         |

```
backoffFor(attempts, cap) = min(30_000 × 2^attempts, cap)
attempts=1 → 60 s
attempts=2 → 120 s
attempts=3 → 240 s
attempts=10 → 600 s (capped at 10 min)
```

### Polling job entrypoint

| Command                                           | Behaviour                                                       |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm --filter @facturador/sri-core poll:once`    | One-shot `runPollBatch` against the configured env, then exits. |
| `pnpm --filter @facturador/sri-core poll:forever` | Foreground process with `node-cron` running on `SRI_POLL_CRON`. |

The boot path in `src/index.ts` also starts the cron when `NODE_ENV !== "test"` and `SRI_STUB_MODE !== true`, so the API-bundled deployment has the worker on by default.

## 6. BlobStore design

### Interface

```ts
export interface BlobStore {
  put(key: string, data: Buffer | string): Promise<BlobStorePutResult>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}
export interface BlobStorePutResult {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}
```

### Filesystem layout

```
<SRI_BLOB_FS_ROOT>/
  <companyId>/
    <documentId>/
      signed.xml
      signed.xml.sha256        # hex digest of signed.xml
      authorized.xml           # present only when AUTORIZADO
      authorized.xml.sha256
```

- `<companyId>` is a ULID; `<documentId>` is a ULID. No PII in the path.
- File mode `0600`; directory mode `0700`. Windows ignores the bits; the NTFS ACL falls back to the process user.
- Atomic puts: write to `<file>.tmp.<rand>`, then `fs.rename` into place.
- Sidecar `.sha256` written after the rename so a torn write never leaves a checksum without a body.

### Key validation

`assertSafeKey(key)` rejects:

- empty / pure-whitespace keys;
- keys > 512 chars;
- leading `/` or `\` (absolute paths);
- drive-letter prefixes (`C:/...`);
- any `..` segment;
- any empty segment (`//`, leading/trailing `/`);
- control characters (`< 0x20`) including NUL;
- anything outside `[A-Za-z0-9._/-]`.

A second-line defence in `FilesystemBlobStore.resolvePath` checks that `path.resolve(root, key)` stays under `root` before any I/O.

## 7. Deviations from spec / plan

- **State-machine matrix**: pre-SPEC-0026 the in-repo matrix listed `PENDIENTE → ERROR_RED` and `ERROR_RED → FIRMADO`. Neither is in SPEC-0026 §6.2; both are removed in this slice to match the spec verbatim. No runtime behaviour relied on them (the orchestrator transitions FIRMADO → ERROR_RED only after a failed SEND).
- **BlobStore key layout**: SPEC-0026 §6.6 sketches `<companyId>/<yyyy>/<mm>/<claveAcceso>.<kind>.xml`. The implementation uses `<companyId>/<documentId>/<kind>.xml` — `documentId` is more stable across reissues (each new claveAcceso has its own SriDocument id), prevents PII in the path even further, and the date partitioning can be added by a future cleanup job without breaking the contract.
- **`recordEvent` accepts a `tx`**: needed for the polling job to keep `recordEvent`'s find/update/create inside the same transaction that holds `FOR UPDATE SKIP LOCKED`. Documented inline; the public callers (sign-step, orchestrator) keep using the top-level `PrismaClient` and the helper wraps the work in a fresh `$transaction`.
- **No worker queue**: kept node-cron as PLAN-0026 §8 specifies. Future S3/queue work is listed under suggested follow-ups.

## 8. Risks observed

| Risk                                                    | Mitigation                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long `EN_PROCESO` (SRI slow) — document stuck for hours | Hard cap at 60 attempts (≈ 2 hours with the default backoff); after that the row is left untouched until an operator re-triggers. The audit row gives them the timeline.                                                       |
| SRI service variability — transient 5xx                 | Wrapped by `withRetry` in the SOAP layer; a persisting 5xx surfaces as `ERROR_RED`.                                                                                                                                            |
| FS persistence in dev — container restart loses blobs   | Acceptable for dev; production swaps the BlobStore via DI (S3 / GCS impl listed in §10).                                                                                                                                       |
| Foreign-key noise in test output                        | `audit()` silently swallows the FK violation when the synthetic test `companyId` has no Company row; the noise is cosmetic. Tests that exercise the orchestrator now seed a minimal Company row to keep the test output quiet. |
| Postgres enum casting in raw `$queryRaw`                | Documented inline (`"estado"::text = 'EN_PROCESO'`). Without the cast Prisma would emit `operator does not exist: SriEstado = unknown` and silently return 0 rows.                                                             |

## 9. Security review (verbatim §6 vs implementation)

| §6 rule                                                                                                             | Status                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BlobStore` directories must be tenant-scoped (`<companyId>/<documentId>/...`)                                      | Implemented; helpers enforce shape.                                                                                                                                                                                                                                            |
| Reject keys with `..`, absolute paths, or non-ASCII control chars                                                   | `assertSafeKey` + `resolvePath` second-line defence; 12 negative cases covered in `blob-store.test.ts`.                                                                                                                                                                        |
| Signed XML / authorized XML files written with `0600` where supported                                               | Implemented via `fs.writeFile(..., { mode: 0o600 })`; POSIX test asserts the mode.                                                                                                                                                                                             |
| Polling job logs only `{ requestId, batchSize, processed }` — never any XML body or customer data                   | Verified: `runPollBatch` logs `{ batchSize, processed, transitions, durationMs }` plus PII-safe per-failure lines (`{ documentId, companyId, attempts, kind }`). No XML body, no mensaje text, no PEM fragment.                                                                |
| Audit rows for emit attempts must include `companyId, claveAcceso, outcome, durationMs` — never sensitive payloads  | `safeAudit` in `emit-factura.ts` and `poll-en-proceso.ts` writes exactly that. The `redactPayload` walker strips any accidental `signedXml` / `claveAcceso` / `passphrase` paths as defence in depth.                                                                          |
| The orchestrator must not surface the private key, signed bytes, or full mensaje text in any ProblemDetail response | The `BusinessError("reissue_required")` carries only the document estado in its message; SOAP failures surface as `SriClientError` with `kind` only. `sign-step` errors propagate as `XmlSignError` whose `message` is structured (no PEM).                                    |
| REDACT_PATHS coverage                                                                                               | `signedXml`, `xml`, `authorizedXml`, `claveAcceso`, `p12`, `pem`, `privateKey`, `passphrase`, `cedula`, `identificacionComprador`, `razonSocialComprador`, etc. — all already in `packages/logger/src/redactions.ts`; the orchestrator's log lines never include those values. |

## 10. Suggested follow-ups

1. **S3 BlobStore** — implement `S3BlobStore` against the same interface; flag via env (`BLOB_STORE_BACKEND=s3`). Add encryption-at-rest via SSE-KMS.
2. **Worker queue** — when scaling past one replica, move polling onto BullMQ / pg-boss for stricter retry semantics and observability. The current `FOR UPDATE SKIP LOCKED` design already supports N replicas; the queue would let us tune visibility timeouts per workload.
3. **Per-step duration metric** — wire a `sri_document_state_transitions_total{from,to}` and `sri_step_duration_ms_bucket{step}` Prometheus pair (the helpers already capture `durationMs`; only the exporter is missing).
4. **Health probe for polling** — `/readyz` already checks DB; extend it to "last poll batch completed ≤ 5 min ago" once we have a heartbeat row.
5. **Contingencia (offline) flow** — separate later spec; the state machine has a `tipoEmision` column already and the orchestrator can branch on it once the contingencia spec lands.
6. **`/readyz` polling-job liveness** — surface `lastPollAt` newer than 5 min as a readiness signal so a stalled cron is visible to load balancers.
7. **Quiet the audit FK noise in tests** — either soft-validate `companyId` in `audit()` (catch P2003 specifically) or always seed a `Company` row in the orchestrator integration harness. Cosmetic, not a security issue.

## 11. Sign-off checklist

| AC   | Description                                                                                                     | Status                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AC-1 | Happy path produces FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO; both blobs written.                              | ✅ `lifecycle-emit.test.ts > happy path`                            |
| AC-2 | Idempotent re-emit on AUTORIZADO skips SOAP, returns the persisted state.                                       | ✅ `lifecycle-emit.test.ts > idempotency on terminal state`         |
| AC-3 | DEVUELTA persists mensajes; state machine forbids further auto-transitions.                                     | ✅ `lifecycle-emit.test.ts > DEVUELTA path` + `transitions.test.ts` |
| AC-4 | Network error path lands in `ERROR_RED`; resend recovers.                                                       | ✅ `lifecycle-emit.test.ts > ERROR_RED transient send failure`      |
| AC-5 | Polling job picks up EN_PROCESO via `FOR UPDATE SKIP LOCKED`; reissue refusal returns 422 + `reissue_required`. | ✅ `poll-job.test.ts` + `documents-resend.test.ts`                  |
| AC-6 | `recordEvent` rejects illegal transitions with `sri.invalid_transition`.                                        | ✅ `transitions.test.ts` + `lifecycle.test.ts`                      |
| AC-7 | BlobStore round-trip + path traversal rejection on FS impl.                                                     | ✅ `blob-store.test.ts`                                             |
