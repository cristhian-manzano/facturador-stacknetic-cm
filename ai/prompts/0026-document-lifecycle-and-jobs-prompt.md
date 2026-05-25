---
id: PROMPT-0026
spec: SPEC-0026
plan: PLAN-0026
tasks: TASKS-0026
title: Execute TASKS-0026 — Document lifecycle & async jobs
---

# PROMPT-0026 — Execute document lifecycle & async jobs

You are an autonomous senior backend engineer experienced in state machines, async pipelines, and Postgres-driven queues. Execute **TASKS-0026**: tie SPECs 0020–0025 together into one orchestrator (`emitFactura`) and a polling job, with strict state-machine enforcement and a swappable BlobStore.

---

## 1. Mandatory reading

1. `ai/specs/0026-document-lifecycle-and-jobs.md` — authoritative.
2. `ai/plans/0026-document-lifecycle-and-jobs-plan.md`.
3. `ai/tasks/0026-document-lifecycle-and-jobs-tasks.md`.
4. `ai/specs/0020-sri-core-service-bootstrap.md`, `0023`, `0024`, `0025` — pipeline pieces.
5. `ai/specs/0021-certificate-management.md` — `getActiveCertificate`.
6. `ai/specs/0006-error-model-and-logging.md` — error model + audit.
7. `ai/context/sri-domain.md` — flow context.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ BlobStore interface + FS impl; orchestrator; polling job; state-machine enforcement; migration for polling fields.
- ❌ Do NOT introduce a worker queue (BullMQ etc.).
- ❌ Do NOT implement contingencia / anulación / NC / ND / retención (separate later specs).
- ❌ Do NOT bypass `canTransition`.
- ❌ Do NOT reuse a claveAcceso for reissue.

## 3. Stack constraints

- Express 5 (existing).
- Prisma 5 with raw query for `FOR UPDATE SKIP LOCKED`.
- `node-cron` for scheduling.
- TypeScript strict; ESM only.

## 4. Code quality bar

- Orchestrator's `emitFactura` is idempotent given a document id; second call on terminal state is a no-op.
- Each state transition runs through `recordEvent`; durationMs measured per step.
- The polling job is safe to run on multiple sri-core replicas (locking proved by test).
- BlobStore rejects path-traversal keys.
- Migration is reviewed (`migration.sql` snippet in review file).

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/sri-core test` exits 0.
- Coverage on `lifecycle/*.ts` and `jobs/*.ts` ≥ 85%.
- Happy path produces 4 events: FIRMADO, ENVIADO (or RECIBIDA — at minimum one ENVIADO/RECIBIDA event acceptable), AUTORIZADO; durationMs > 0 in each.
- DEVUELTA path does NOT retry.
- EN_PROCESO path: poller transitions to AUTORIZADO at a subsequent tick.
- ERROR_RED + `/resend` recovers.
- Idempotent call on AUTORIZADO is a no-op (no new event row).
- Reissue refusal returns 422 + `code:"reissue_required"`.

## 6. Security considerations

- BlobStore directories must be tenant-scoped (`<companyId>/<documentId>/...`).
- BlobStore rejects keys with `..`, absolute paths, or non-ASCII control chars.
- Signed XML and authorized XML files are written with `0600` permissions where supported.
- The polling job logs only `{ requestId, batchSize, processed }` — never any XML body or customer data.
- Audit rows for emit attempts must include companyId, claveAcceso, outcome, durationMs — never sensitive payloads.
- The orchestrator must not surface the private key, signed bytes, or full mensaje text in any ProblemDetail response.

## 7. Deliverables

When TASKS-0026 is green, write `ai/reviews/0026-document-lifecycle-and-jobs-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage report.
   - Test outputs for each lifecycle path.
   - Migration SQL snippet (polling fields).
4. **State machine matrix** — final implemented table.
5. **Polling cadence** — schedule + backoff for `nextPollAt`.
6. **BlobStore design** — interface + FS layout.
7. **Deviations from spec/plan**.
8. **Risks observed** — long EN_PROCESO durations; SRI service variability; FS persistence in dev.
9. **Security review** — confirm §6 verbatim.
10. **Suggested follow-ups** — S3 BlobStore; worker queue; metrics on each step's duration.
11. **Sign-off checklist** — SPEC-0026 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0026 boxes ticked.
- All tests green; full pipeline observable.
- Review file complete.

Begin.
