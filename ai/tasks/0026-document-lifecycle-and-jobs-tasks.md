---
id: TASKS-0026
spec: SPEC-0026
plan: PLAN-0026
title: Document lifecycle & async jobs — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0026 — Document lifecycle & async jobs

> Checklist for [SPEC-0026](../specs/0026-document-lifecycle-and-jobs.md) + [PLAN-0026](../plans/0026-document-lifecycle-and-jobs-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never bypass `canTransition` when updating `SriDocument.estado`.
- ❌ Never reuse a claveAcceso for reissue (caller mints a new one).
- ❌ Never retry a business error (DEVUELTA / NO_AUTORIZADO) — caller must reissue.
- ✅ Every state change writes an `SriEvent` row.
- ✅ Polling uses `FOR UPDATE SKIP LOCKED` to be safe under multiple workers.

## 1. BlobStore

- [ ] **1.1** `apps/sri-core/src/blobs/blob-store.ts`:

  - Interface as PLAN §4 Phase 1.
  - `FilesystemBlobStore` writes to `<BLOB_DIR>/<companyId>/<documentId>/<name>`; defaults to `./.blobs/`; env var override.
  - Reject keys containing `..` or absolute paths.
    **Validate**: unit test put/get/remove round-trip; key with `..` rejected.

- [ ] **1.2** `.gitignore` blocks `.blobs/`.
      **Validate**: `git check-ignore -v .blobs/x` returns the rule.

## 2. State machine

- [ ] **2.1** Reaffirm `canTransition(from, to)` matches the table in PLAN §3. Add any missing transitions per SPEC-0026.
      **Validate**: exhaustive matrix test passes with the spec table.

- [ ] **2.2** `recordEvent` updates the row's `estado` only via `canTransition`; throws if disallowed.
      **Validate**: integration test attempts PENDIENTE → AUTORIZADO directly; expects throw.

## 3. Orchestrator

- [ ] **3.1** `apps/sri-core/src/lifecycle/emit-factura.ts`:
  - Loads document. If terminal (`AUTORIZADO`, `NO_AUTORIZADO`, `DEVUELTA`): return current state (idempotent).
  - If `PENDIENTE` or `ERROR_RED`: run pipeline per PLAN §4 Phase 2.
  - Stores signed XML via BlobStore on FIRMADO; stores authorized XML on AUTORIZADO.
  - Updates `numeroAutorizacion`, `fechaAutorizacion`, `mensajesJson` per result.
  - All state changes via `recordEvent`.
    **Validate**: §5.

## 4. Polling job

- [ ] **4.1** `apps/sri-core/src/jobs/poll-en-proceso.ts`:

  - `runPollBatch(prisma, clients)` queries up to 50 documents `WHERE estado='EN_PROCESO' AND nextPollAt <= now() FOR UPDATE SKIP LOCKED`.
  - For each: call `AutorizacionClient.query(claveAcceso)`; if AUTORIZADO/NO_AUTORIZADO: `recordEvent`; else: bump `attempts`, update `lastPollAt`, set `nextPollAt = now() + min(30s * 2^attempts, 10min)`.
  - Sleep 1 s between docs.
    **Validate**: integration test seeds 3 EN_PROCESO docs; mocks the autorización client to return AUTORIZADO for 1, EN_PROCESO for 1, NO_AUTORIZADO for 1; after runPollBatch the states are as expected.

- [ ] **4.2** Schema additions: `SriDocument.nextPollAt DateTime?`, `lastPollAt DateTime?`, `pollAttempts Int @default(0)`. Migration `sri_polling_fields`.
      **Validate**: `pnpm prisma migrate status` clean.

- [ ] **4.3** Scheduler at boot: `node-cron("*/2 * * * *", runPollBatch, { onlyIf: NODE_ENV !== "test" })`.
      **Validate**: unit test simulates the cron tick triggers `runPollBatch`.

## 5. Tests (unit + integration)

- [ ] **5.1** Happy path test: stubbed RecepcionClient returns RECIBIDA; stubbed AutorizacionClient returns AUTORIZADO; orchestrator transitions PENDIENTE → FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO and writes 4 events.
      **Validate**: pass.

- [ ] **5.2** DEVUELTA path: stubbed RecepcionClient returns DEVUELTA with 2 mensajes; orchestrator records DEVUELTA + mensajes; no retry.
      **Validate**: pass.

- [ ] **5.3** EN_PROCESO path: stubbed autorización returns EN_PROCESO; orchestrator records EN_PROCESO with `nextPollAt`; poller after `nextPollAt` transitions to AUTORIZADO with subsequent mock.
      **Validate**: pass.

- [ ] **5.4** ERROR_RED path: stubbed RecepcionClient throws a transient `NetworkError`; orchestrator records ERROR_RED; `/resend` re-runs SEND and reaches RECIBIDA.
      **Validate**: pass.

- [ ] **5.5** ERROR_BUILD path: stubbed builder throws; orchestrator records ERROR_BUILD; `/resend` runs BUILD again.
      **Validate**: pass.

- [ ] **5.6** Idempotency: call `emitFactura(id)` twice in a row when state is AUTORIZADO; second call is a no-op (no new events).
      **Validate**: pass.

- [ ] **5.7** Reissue refusal: `/resend` on `DEVUELTA` returns 422 + `code:"reissue_required"`.
      **Validate**: pass.

## 6. Acceptance criteria

- [ ] AC-1: Pipeline produces FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO in the happy path.
- [ ] AC-2: Each step writes an event with `durationMs`.
- [ ] AC-3: State machine enforced via `canTransition`.
- [ ] AC-4: Polling job picks up EN_PROCESO; uses `FOR UPDATE SKIP LOCKED`.
- [ ] AC-5: Reissue refusal returns 422 + `code:"reissue_required"`.
- [ ] AC-6: BlobStore persists artefacts; FS impl in dev; rejects path traversal.
- [ ] AC-7: All edge paths covered (transient, build failure, mensaje 43 idempotency).

## 7. Definition of Done

- All boxes ticked; all tests green.
- Review file `ai/reviews/0026-document-lifecycle-and-jobs-review.md` written.
