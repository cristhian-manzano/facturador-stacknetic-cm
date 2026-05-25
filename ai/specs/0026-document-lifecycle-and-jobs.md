---
id: SPEC-0026
title: SRI document lifecycle & async jobs
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0006, SPEC-0020, SPEC-0021, SPEC-0023, SPEC-0024, SPEC-0025]
blocks: [SPEC-0033]
---

# SPEC-0026 — Document lifecycle & async jobs

## 1. Purpose

Glue everything in SRI Core together: build → sign → send → persist → poll → finalise. Define the **state machine**, the per-document audit trail (`SriEvent`), and the **polling job** that drives `RECIBIDA`/`EN_PROCESO` documents to a terminal state.

## 2. Scope

### 2.1 In scope

- State machine for `SriDocument.estado`.
- `emitFactura` orchestrator (called by the SRI Core emit handler).
- Persistence of `SriDocument` and `SriEvent` rows.
- Blob storage for `signedXml` and `authorizedXml` (filesystem in dev, configurable for prod).
- Polling job that picks `RECIBIDA | EN_PROCESO | ERROR_RED` and consults autorización.
- Idempotency on `claveAcceso` (SRI message id `43` = already received).
- Contingencia handling — graceful degradation when SRI is unreachable.

### 2.2 Out of scope

- API-side orchestration (build the business payload, reserve secuencial) — that's [SPEC-0033](./0033-invoice-emission-orchestrator.md).
- RIDE PDF generation (later spec).
- Email delivery (later spec).

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §12, §13, §17.
- [`ai/context/sri-domain.md`](../context/sri-domain.md) §State machine.
- [SPEC-0020](./0020-sri-core-service-bootstrap.md) §6.4 — `SriDocument`, `SriEvent`.

## 4. Functional requirements

- **FR-1.** State machine:

  ```
  PENDIENTE
    │
    ├─(build error / xsd error)─▶ ERROR_BUILD (terminal — re-emit requires new payload)
    │
    └─(signed)─▶ FIRMADO
        │
        └─(sent)─▶ ENVIADO
            │
            ├─(recepcion: RECIBIDA)─▶ RECIBIDA
            │    │
            │    ├─(autorización: AUTORIZADO)─▶ AUTORIZADO   (terminal ✓)
            │    ├─(autorización: NO AUTORIZADO)─▶ NO_AUTORIZADO (terminal ✗)
            │    └─(autorización: EN PROCESO)─▶ EN_PROCESO  ──(poll)──▶ RECIBIDA → ...
            │
            ├─(recepcion: DEVUELTA)─▶ DEVUELTA              (terminal ✗; corregir y reemitir con nueva clave)
            │
            └─(network error)─▶ ERROR_RED                   (cron retries up to N times then alerts)
  ```

  Allowed transitions only as drawn. Any other update is rejected by the persistence layer.

- **FR-2.** `emitFactura(input)` orchestrator (called from `apps/sri-core/src/documents/handlers/emit.ts`):

  ```ts
  export const emitFactura = async (input: EmitFacturaInput): Promise<EmitFacturaOutput> => {
    // 1. Persist a SriDocument row in PENDIENTE (idempotent by claveAcceso).
    // 2. Load active certificate.
    // 3. Build XML, validate XSD.
    // 4. Sign XML.
    // 5. Persist signedXml blob; transition to FIRMADO.
    // 6. Send recepción (SRI SOAP). Persist SriEvent.
    //    - DEVUELTA → set estado + return.
    //    - RECIBIDA → set estado, then try ONE synchronous autorización call (best effort).
    //    - network error → set ERROR_RED + return.
    // 7. If autorización returned AUTORIZADO/NO_AUTORIZADO → finalise.
    //    Else EN_PROCESO → set EN_PROCESO + return (polling job will pick up).
    // 8. Return EmitDocumentResponse.
  };
  ```

- **FR-3.** Idempotency: a second emit call with the same `claveAcceso` checks the existing row:

  - If `AUTORIZADO`/`NO_AUTORIZADO`/`DEVUELTA` → return that state without re-sending.
  - If `RECIBIDA`/`EN_PROCESO` → skip re-sending; jump to autorización query.
  - If `ERROR_RED`/`PENDIENTE`/`FIRMADO`/`ENVIADO` → re-run from the failure step.
  - SRI message `43` (`CLAVE ACCESO REGISTRADA`) handled as success → advance to autorización.

- **FR-4.** Blob storage:

  - Dev: filesystem at `./.local/blobs/<companyId>/<yyyy>/<mm>/<claveAcceso>.signed.xml` and `.authorized.xml`.
  - Production interface: `BlobStore` with methods `put(key, bytes)`, `get(key)`, `delete(key)`. Implementation per environment.

- **FR-5.** Polling job:

  - Runs every 2 minutes (cron `*/2 * * * *`).
  - Selects up to 50 documents in `(RECIBIDA, EN_PROCESO, ERROR_RED)` ordered by `updatedAt asc`, throttled to 1 query per second per call to avoid hammering SRI.
  - On success: transition state, persist `SriEvent`.
  - On repeated `ERROR_RED` (`updatedAt` not advancing for > 30 min): emit `sri.network_persistent` audit + downgrade to `ERROR_RED` with `metadata.attempts++`.
  - Single-replica safe; multi-replica requires Postgres advisory lock (out of scope for v1).

- **FR-6.** Audit (via [SPEC-0006](./0006-error-model-and-logging.md) `audit()`):
  - `sri.recepcion.sent`, `sri.recepcion.recibida`, `sri.recepcion.devuelta`
  - `sri.autorizacion.queried`, `sri.autorizacion.autorizado`, `sri.autorizacion.no_autorizado`, `sri.autorizacion.en_proceso`
  - Each carries `claveAcceso`, `durationMs`, `httpStatus` in metadata.

## 5. Non-functional requirements

- **NFR-1.** Emit path (build + sign + recepcion + best-effort autorización) ≤ 5 s P95 when SRI is responsive.
- **NFR-2.** Polling job loop never exceeds 60 s wall-clock per invocation; if backlog larger, picks up next tick.
- **NFR-3.** Idempotency: at-least-once semantics on emit — duplicate calls never produce a second SRI submission.

## 6. Technical design

### 6.1 Layout

```
apps/sri-core/src/documents/
├── emit/
│   ├── orchestrator.ts      # emitFactura()
│   ├── persistence.ts       # CRUD on SriDocument, SriEvent
│   └── state-machine.ts     # allowed transitions
├── jobs/
│   └── polling.ts           # cron loop
└── blobs/
    ├── blob-store.ts        # interface
    └── fs-blob-store.ts     # filesystem impl
```

### 6.2 State machine

```ts
// state-machine.ts
type Estado =
  | "PENDIENTE"
  | "ERROR_BUILD"
  | "FIRMADO"
  | "ENVIADO"
  | "RECIBIDA"
  | "EN_PROCESO"
  | "AUTORIZADO"
  | "NO_AUTORIZADO"
  | "DEVUELTA"
  | "ERROR_RED";

const ALLOWED: Record<Estado, Estado[]> = {
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
  ], // self-loop allowed for retry bookkeeping
  AUTORIZADO: [],
  NO_AUTORIZADO: [],
  DEVUELTA: [],
};

export const canTransition = (from: Estado, to: Estado): boolean => ALLOWED[from].includes(to);
```

Repository helper `updateEstado(docId, from, to, ...)` enforces this with a `WHERE estado = from` clause and asserts one row affected.

### 6.3 Persistence helpers (sketch)

```ts
// persistence.ts
export const upsertDocPending = (input: {...}) => prisma.sriDocument.upsert({ where: { claveAcceso: input.claveAcceso }, update: {}, create: { ... estado: "PENDIENTE" } });

export const transition = async (id: string, from: Estado, to: Estado, patch: Partial<SriDocument> = {}) => {
  if (!canTransition(from, to)) throw new AppError("sri.invalid_transition", 409, `Invalid transition ${from} → ${to}`);
  const r = await prisma.sriDocument.updateMany({ where: { id, estado: from }, data: { estado: to, ...patch } });
  if (r.count !== 1) throw new AppError("sri.transition_race", 409, "Concurrent update");
};

export const writeEvent = (docId: string, etapa: "RECEPCION" | "AUTORIZACION", payload: { estado: string; mensajes?: Mensaje[]; durationMs: number }) =>
  prisma.sriEvent.create({ data: { id: ulid(), documentId: docId, etapa, estado: payload.estado, mensajes: payload.mensajes ?? [], durationMs: payload.durationMs } });
```

### 6.4 Orchestrator (key flow)

```ts
// emit/orchestrator.ts
import { transition, upsertDocPending, writeEvent, getDocByClave } from "./persistence.js";
import { loadActiveCertForSigning } from "../../certificates/load-for-signing.js";
import { buildFacturaXml } from "../factura/builder.js";
import { validateAgainstFacturaXsd } from "../factura/xsd-validator.js";
import { signFacturaXml } from "../sign/sign-factura.js";
import { sendRecepcion, consultarAutorizacion } from "../../sri/index.js";
import { blobStore } from "../blobs/index.js";
import { audit } from "../../audit/audit.js";
import { AppError } from "../../errors/app-error.js";

export const emitFactura = async (input: EmitFacturaInput): Promise<EmitFacturaOutput> => {
  // 1. Idempotent upsert
  const doc = await upsertDocPending({ ...input });

  // Short-circuit on terminal states
  if (["AUTORIZADO", "NO_AUTORIZADO", "DEVUELTA"].includes(doc.estado)) return summarise(doc);

  // 2. Cert
  const { privateKeyPem, certPem } = await loadActiveCertForSigning(input.companyId);

  // 3. Build + XSD
  const xml = buildFacturaXml(input.factura);
  const xsd = validateAgainstFacturaXsd(xml);
  if (!xsd.ok) {
    await transition(doc.id, doc.estado, "ERROR_BUILD");
    throw new AppError("invoice.xsd_invalid", 422, "XML failed local XSD validation", undefined, {
      xsd: xsd.errors,
    });
  }

  // 4. Sign
  const signed = await signFacturaXml({ xml, privateKeyPem, certPem });
  await blobStore.put(blobKey(doc, "signed"), Buffer.from(signed, "utf8"));
  await transition(doc.id, doc.estado, "FIRMADO");

  // 5. Recepción
  try {
    const t0 = Date.now();
    const r = await sendRecepcion(Buffer.from(signed, "utf8"), input.ambiente);
    await writeEvent(doc.id, "RECEPCION", {
      estado: r.estado,
      mensajes: r.mensajes,
      durationMs: r.durationMs,
    });
    await audit({
      action: "sri.recepcion.sent",
      companyId: input.companyId,
      resource: `claveAcceso:${input.claveAcceso}`,
      metadata: { estado: r.estado, durationMs: r.durationMs },
    });

    if (r.estado === "DEVUELTA") {
      await transition(doc.id, "FIRMADO", "DEVUELTA");
      return summarise(await getDocByClave(input.claveAcceso));
    }
    await transition(doc.id, "FIRMADO", "ENVIADO");
    await transition(doc.id, "ENVIADO", "RECIBIDA");
  } catch (err) {
    await transition(doc.id, "FIRMADO", "ERROR_RED");
    throw new AppError("sri.network", 503, "SRI recepción failed (queued for retry)");
  }

  // 6. Best-effort autorización (sync)
  try {
    const a = await consultarAutorizacion(input.claveAcceso, input.ambiente);
    await writeEvent(doc.id, "AUTORIZACION", {
      estado: a.estado,
      mensajes: a.mensajes,
      durationMs: a.durationMs,
    });
    await applyAutorizacion(doc.id, a);
  } catch {
    // Leave in RECIBIDA; polling job will retry.
  }

  return summarise(await getDocByClave(input.claveAcceso));
};
```

`applyAutorizacion` writes the authorised XML blob, sets `numeroAutorizacion`, `fechaAutorizacion`, and transitions to `AUTORIZADO` / `NO_AUTORIZADO` / `EN_PROCESO`.

### 6.5 Polling job

```ts
// jobs/polling.ts
import cron from "node-cron";
import { prisma } from "../../db/client.js";
import { consultarAutorizacion } from "../../sri/index.js";
import { applyAutorizacion, transition } from "../emit/persistence.js";

export const startPollingJob = () =>
  cron.schedule("*/2 * * * *", async () => {
    const docs = await prisma.sriDocument.findMany({
      where: { estado: { in: ["RECIBIDA", "EN_PROCESO", "ERROR_RED"] } },
      orderBy: { updatedAt: "asc" },
      take: 50,
    });
    for (const d of docs) {
      try {
        const a = await consultarAutorizacion(d.claveAcceso, d.ambiente as "1" | "2");
        await writeEvent(d.id, "AUTORIZACION", {
          estado: a.estado,
          mensajes: a.mensajes,
          durationMs: a.durationMs,
        });
        await applyAutorizacion(d.id, a);
      } catch {
        await transition(d.id, d.estado as any, "ERROR_RED");
      }
      await sleep(1000);
    }
  });
```

### 6.6 Blob storage interface

```ts
// blobs/blob-store.ts
export interface BlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
```

Dev impl writes under `./.local/blobs/`. Production swaps in an S3-compatible implementation.

## 7. Implementation guide

### 7.1 Steps

1. Implement files per §6.
2. Wire the orchestrator into `apps/sri-core/src/documents/handlers/emit.ts`.
3. Start the polling job from `apps/sri-core/src/main.ts` only when `NODE_ENV !== "test"`.
4. Tests:
   - Orchestrator happy path with stub SOAP returning RECIBIDA + AUTORIZADO.
   - Orchestrator DEVUELTA → state DEVUELTA + mensajes persisted.
   - Orchestrator with simulated network error → ERROR_RED + throws `sri.network`.
   - Idempotent re-emit of an `AUTORIZADO` document returns the same response without re-sending.
   - Polling job picks up an `EN_PROCESO` document and moves it to `AUTORIZADO` when SOAP stub returns AUTORIZADO.
   - State machine: invalid transitions rejected.

### 7.2 Dependencies

(All already present from earlier specs.)

### 7.3 Conventions

- Every state transition goes through `transition()` — no `prisma.sriDocument.update({ estado })` calls elsewhere.
- Blob keys: `<companyId>/<yyyy>/<mm>/<claveAcceso>.<kind>.xml`. Deterministic.
- The orchestrator **never** logs the signed/authorised XML. It logs the SHA-256 of each blob via `sri-soap-clients` results.

## 8. Acceptance criteria

- **AC-1.** Happy path: stub SOAP returns RECIBIDA then AUTORIZADO; `emitFactura` returns `estado: "AUTORIZADO"`, persists both events, writes both blobs.
- **AC-2.** Idempotent re-emit: second call with same `claveAcceso` skips SOAP, returns the persisted state.
- **AC-3.** DEVUELTA path: persists mensajes; state machine forbids further auto-transitions.
- **AC-4.** Network error path: state ends in `ERROR_RED`, exception code `sri.network` (5xx-style).
- **AC-5.** Polling job: a doc in EN_PROCESO moves to AUTORIZADO after one cycle when SOAP returns AUTORIZADO.
- **AC-6.** `transition(doc, RECIBIDA → ENVIADO)` is rejected with `sri.invalid_transition`.
- **AC-7.** Blob store dev impl creates the file and `get` returns identical bytes.
- **AC-8.** Audit log entries exist for every SOAP call with `metadata.estado` and `metadata.durationMs`.

## 9. Test plan

- Unit: state-machine table-driven.
- Unit: persistence helpers.
- Integration: orchestrator against test DB + stub SOAP + stub blob store.
- Concurrency: two parallel `emitFactura` calls for the same clave → second short-circuits (idempotent upsert + state read).

## 10. Security considerations

- Blobs may contain customer PII (the signed XML carries `razonSocialComprador`, `identificacionComprador`). Treat the blob store as PII storage; production implementation must encrypt at rest and require authenticated reads.
- The polling job's outgoing SOAP traffic is unauthenticated per SRI design — that's OK; SRI doesn't authenticate inbound calls. Our outbound TLS is enough.

## 11. Observability

- Metric (future): `sri_document_state_transitions_total{from,to}`.
- Per-doc audit chain is the durable timeline.
- Health: `/readyz` includes "polling job last run ≤ 5 min ago" check.

## 12. Risks and mitigations

| Risk                                    | Mitigation                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Polling job runs twice on multi-replica | Disable polling on all but one replica via env `ENABLE_POLLING=true` for now; future Postgres advisory lock.                      |
| Orphan blobs after schema delete        | Retention policy is mandated by SRI (7 years). Soft-delete `SriDocument`, never delete blobs except via a retention job (future). |
| State drift between SRI and us          | Polling reconciles. Operator-facing UI ([SPEC-0043](./0043-web-invoice-list-and-detail.md)) exposes the timeline.                 |

## 13. Open questions

- Move polling to a real job queue (BullMQ/pg-boss)? Yes, when scaling beyond a single replica. For v1, `node-cron` is enough.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
