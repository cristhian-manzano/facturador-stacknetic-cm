---
id: PLAN-0026
spec: SPEC-0026
title: Document lifecycle & async jobs — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0026 — Document lifecycle & async jobs

> Implementation plan for [SPEC-0026](../specs/0026-document-lifecycle-and-jobs.md). Depends on PLAN-0020/0021/0023/0024/0025.

## 1. Goal

Tie SPECs 0020–0025 together with a coherent state machine and a polling job:

- A single orchestrator `emitFactura(documentId)` runs the canonical pipeline: BUILD → SIGN → SEND (recepción) → AUTHORIZE (autorización).
- Strict state-machine enforcement (`canTransition`).
- Idempotent on `claveAcceso`: re-invocation does not double-emit.
- Polling job processes documents stuck in `EN_PROCESO` every 2 min (50 docs/batch; 1 s sleep between docs).
- `BlobStore` interface persists `signedXml` and `authorizedXml`; filesystem implementation for dev (`./.blobs/`); production swappable to S3/GCS in a later spec.
- A "contingencia" branch is documented but not implemented yet (later spec).

## 2. Inputs

- [SPEC-0026](../specs/0026-document-lifecycle-and-jobs.md) — authoritative.
- [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md), [SPEC-0023](../specs/0023-xml-builder-factura.md), [SPEC-0024](../specs/0024-xades-bes-signer.md), [SPEC-0025](../specs/0025-sri-soap-clients.md).
- [ai/context/sri-domain.md](../context/sri-domain.md) — overall flow.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                                                                                         | Rationale                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| The orchestrator runs **synchronously** for the initial milestone (within the request lifetime). EN_PROCESO is the only case where we hand off to the cron poller.                                                                                                               | Simplifies v1; AUTORIZADO often returns within the same request. |
| State transitions go through `recordEvent`, which checks `canTransition`.                                                                                                                                                                                                        | Single point of enforcement.                                     |
| BlobStore is an interface; FS impl in dev, S3 impl deferred.                                                                                                                                                                                                                     | Predictable artefact storage.                                    |
| Polling job uses **PostgreSQL row locking** (`FOR UPDATE SKIP LOCKED`) to allow horizontal scaling.                                                                                                                                                                              | Multiple sri-core workers safe.                                  |
| Poll batch size 50; sleep 1 s between docs.                                                                                                                                                                                                                                      | Polite to SRI.                                                   |
| Job lifecycle: scheduler picks up rows where `estado='EN_PROCESO'` and `nextPollAt <= now()`. After polling, update `lastPollAt`, `nextPollAt`, and `attempts++`. After N attempts (e.g., 60 attempts = 2 hours), escalate to audit + leave estado unchanged (still EN_PROCESO). | Avoids spinning forever.                                         |
| Idempotency: orchestrator looks up existing document by claveAcceso before insert; if found and not in BORRADOR-equivalent state, reuse.                                                                                                                                         | Required by SPEC-0020.                                           |
| Reissue path: caller (api) re-creates the BORRADOR with a NEW claveAcceso (new secuencial); the old claveAcceso is **not** reused.                                                                                                                                               | SRI sequencing rules.                                            |

### State machine matrix

| from \ to      | PENDIENTE | FIRMADO | ENVIADO | RECIBIDA | EN_PROCESO | AUTORIZADO | NO_AUTORIZADO | DEVUELTA | ERROR_RED | ERROR_BUILD         |
| -------------- | --------- | ------- | ------- | -------- | ---------- | ---------- | ------------- | -------- | --------- | ------------------- |
| (initial)      | ✅        |         |         |          |            |            |               |          |           | ✅ (if BUILD fails) |
| PENDIENTE      |           | ✅      |         |          |            |            |               |          |           | ✅                  |
| FIRMADO        |           |         | ✅      |          |            |            |               |          | ✅        |                     |
| ENVIADO        |           |         |         | ✅       |            |            |               | ✅       | ✅        |                     |
| RECIBIDA       |           |         |         |          | ✅         | ✅         | ✅            |          | ✅        |                     |
| EN_PROCESO     |           |         |         |          |            | ✅         | ✅            |          | ✅        |                     |
| ERROR_RED      |           |         | ✅      |          |            |            |               |          | ✅        |                     |
| Other terminal | none      |         |         |          |            |            |               |          |           |                     |

(Same as SPEC-0026; reproduced here for the executor.)

## 4. Phases

### Phase 1 — BlobStore

`apps/sri-core/src/blobs/blob-store.ts`:

- `interface BlobStore { put(key: string, body: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }`.
- `FilesystemBlobStore` impl rooted at `./.blobs/<companyId>/<documentId>/{signed.xml,authorized.xml}`.
- The directory is `.gitignored`.

### Phase 2 — Orchestrator

`apps/sri-core/src/lifecycle/emit-factura.ts`:

- Input: `documentId`.
- Loads document (must be PENDIENTE; else returns current state idempotently).
- BUILD step: calls `buildFacturaXml`; on failure → `recordEvent(ERROR_BUILD)` and return.
- SIGN step: loads active cert; calls `signFacturaXml`; on success: persist signed XML via BlobStore; `recordEvent(FIRMADO)`.
- SEND step: calls `RecepcionClient.send`; on transient error: `recordEvent(ERROR_RED)` and return; on RECIBIDA: `recordEvent(RECIBIDA)`; on DEVUELTA: `recordEvent(DEVUELTA)` and return.
- AUTHORIZE step: calls `AutorizacionClient.query`:
  - AUTORIZADO: persist authorized XML via BlobStore; update `numeroAutorizacion`, `fechaAutorizacion`; `recordEvent(AUTORIZADO)`.
  - EN_PROCESO: `recordEvent(EN_PROCESO)`; set `nextPollAt = now + 30 s`.
  - NO_AUTORIZADO: `recordEvent(NO_AUTORIZADO)`.

### Phase 3 — Polling job

`apps/sri-core/src/jobs/poll-en-proceso.ts`:

- Function `runPollBatch(prisma, clients)`:
  - `prisma.$queryRaw` with `FOR UPDATE SKIP LOCKED` to select up to 50 docs where `estado='EN_PROCESO' AND nextPollAt <= now()`.
  - For each: call `AutorizacionClient.query(claveAcceso)`; record state; sleep 1 s.
- Scheduler: cron `*/2 * * * *` only when `NODE_ENV !== "test"`.

### Phase 4 — Retry endpoint

`apps/sri-core/src/routes/documents.ts` updates `POST /v1/documents/:claveAcceso/resend`:

- If estado in `{ERROR_RED, ERROR_BUILD}`: re-run from BUILD/SEND respectively.
- If estado in `{DEVUELTA, NO_AUTORIZADO}`: refuse — caller must reissue with a new claveAcceso (return 422 + `code: "reissue_required"`).

### Phase 5 — Tests

- Unit:
  - `canTransition` exhaustive matrix test.
  - Orchestrator with mocked clients: AUTORIZADO happy path.
  - Orchestrator with mocked DEVUELTA path.
  - Orchestrator with EN_PROCESO path then poller transitions to AUTORIZADO.
- Integration:
  - Real flow against MSW or `undici-mock-agent` SRI stubs.

## 5. Risks & mitigations

| Risk                                                           | Mitigation                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Long-running emit blocks request.                              | For v1 sync is acceptable; if SRI gets slow, add a worker queue in a later spec.           |
| Polling job overlaps with itself.                              | `FOR UPDATE SKIP LOCKED`; a row already locked is skipped.                                 |
| Polling never terminates.                                      | Max attempts ~60; escalates to audit; document remains EN_PROCESO and operator can decide. |
| Idempotency surprise: two requests with same claveAcceso race. | Unique constraint + SELECT before INSERT inside a transaction.                             |
| FS blobs lost on container restart.                            | Acceptable for dev; production uses S3 in a follow-up.                                     |

## 6. Validation strategy

- Unit and integration tests pass.
- A real `docker compose` smoke runs `emitFactura` in stub mode and reaches AUTORIZADO.
- Polling test: seed an EN_PROCESO doc with `nextPollAt = past`; run `runPollBatch`; doc transitions to AUTORIZADO; `lastPollAt` updated.

## 7. Exit criteria

- All SPEC-0026 ACs pass.
- All four pipeline steps observable as events.
- Polling job lives under `apps/sri-core/src/jobs/` with its own tests.

## 8. Out of scope

- Worker queue (BullMQ/RabbitMQ) — later.
- Contingencia (offline batch) flow — separate spec.
- Anulación / NC / ND / retención flows — separate specs.
