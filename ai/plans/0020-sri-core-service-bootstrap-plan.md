---
id: PLAN-0020
spec: SPEC-0020
title: SRI Core service bootstrap — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0020 — SRI Core service bootstrap

> Implementation plan for [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md). Depends on PLAN-0001/0003/0004/0005/0006/0007.

## 1. Goal

Establish the `apps/sri-core` service skeleton: own Prisma models (`Certificate`, `SriDocument`, `SriEvent`), service-to-service JWT auth (HS256, 60 s lifetime), and the **public surface** consumed by `apps/api`:

- `POST /v1/documents/emit` — accepts an emit request, persists `SriDocument`, returns the current state (synchronous initial pipeline up to `EN_PROCESO`/`AUTORIZADO`).
- `GET /v1/documents/:claveAcceso/status` — current state + events.
- `POST /v1/documents/:claveAcceso/resend` — retries from the appropriate state.
- `GET /healthz` — liveness.

No actual SOAP/XML/signing yet — those are SPEC-0021–0026. This slice wires the **contract** so api can be developed against a real-shaped stub.

## 2. Inputs

- [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md) — authoritative.
- [SPEC-0004](../specs/0004-database-and-prisma.md) — Prisma is set up.
- [SPEC-0005](../specs/0005-shared-contracts.md) — service-to-service shapes (`EmitRequestSchema`, `EmitResponseSchema`, `StatusResponseSchema`).
- [SPEC-0006](../specs/0006-error-model-and-logging.md) — ProblemDetail, audit.
- [SPEC-0026](../specs/0026-document-lifecycle-and-jobs.md) — state machine; only the persistence side is implemented here.

## 3. Architecture decisions

| Decision                                                                                                                                                                                         | Rationale                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------- | -------- | ---------- | ---------- | ------------- | -------- | --------- | ------------- | ------------------ |
| sri-core owns its **own Prisma models** (`Certificate`, `SriDocument`, `SriEvent`) but shares the same Postgres + schema.                                                                        | Disjoint tables; each app generates its own client from a single schema. |
| Service-to-service auth: **HS256 JWT** with `aud=sri-core`, `iss=api`, `sub=<companyId>`, `exp` ≤ 60 s.                                                                                          | Stateless, fast, easy to verify; small attack surface.                   |
| Tokens minted by api only; verified by sri-core middleware.                                                                                                                                      | Single direction.                                                        |
| Shared secret `SERVICE_JWT_SECRET` in env.                                                                                                                                                       | Rotated infrequently; documented as a follow-up to move to KMS.          |
| Body's `companyId` must equal the JWT `sub`.                                                                                                                                                     | Defends against token replay across tenants.                             |
| Idempotency: `claveAcceso` is the natural key. Repeating an emit with the same claveAcceso returns the existing document.                                                                        | Required by SPEC-0026.                                                   |
| `SriDocument.estado` field follows the state machine values: `PENDIENTE                                                                                                                          | FIRMADO                                                                  | ENVIADO | RECIBIDA | EN_PROCESO | AUTORIZADO | NO_AUTORIZADO | DEVUELTA | ERROR_RED | ERROR_BUILD`. | Matches SPEC-0026. |
| Events table: every state transition writes an `SriEvent` row.                                                                                                                                   | Auditable timeline; UI consumes via SPEC-0043.                           |
| Stub mode: if `SRI_STUB_MODE=true`, the service simulates a happy-path emission (immediately returns AUTORIZADO) for local dev. **Production must NEVER set this true** (env validator rejects). | Lets web/api be built without the SOAP plumbing of later specs.          |

## 4. Phases

### Phase 1 — Prisma additions

Add to the single `prisma/schema.prisma`:

```
enum SriEstado { PENDIENTE FIRMADO ENVIADO RECIBIDA EN_PROCESO AUTORIZADO NO_AUTORIZADO DEVUELTA ERROR_RED ERROR_BUILD }
enum SriEtapa  { BUILD SIGN SEND RECEIVE AUTHORIZE POLL ERROR }

model Certificate {
  id String @id @db.Char(26)
  companyId String
  alias String
  subjectCN String
  issuerCN String
  validFrom DateTime
  validTo DateTime
  p12CiphertextB64 String
  p12NonceB64 String
  p12TagB64 String
  fingerprintSha256 String @unique
  status String   // ACTIVE | INACTIVE | EXPIRED
  uploadedAt DateTime @default(now())
  @@index([companyId, status])
}

model SriDocument {
  id String @id @db.Char(26)
  companyId String
  tipoComprobante String // "01" factura, etc.
  claveAcceso String @unique
  ambiente String      // "1" | "2"
  numeroAutorizacion String?
  fechaAutorizacion DateTime?
  estado SriEstado
  signedXmlBlobKey String?
  authorizedXmlBlobKey String?
  mensajesJson Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events SriEvent[]
  @@index([companyId, estado, createdAt])
}

model SriEvent {
  id String @id @db.Char(26)
  documentId String
  document SriDocument @relation(fields:[documentId], references:[id], onDelete: Cascade)
  etapa SriEtapa
  estado SriEstado
  mensajesJson Json?
  durationMs Int
  createdAt DateTime @default(now())
  @@index([documentId, createdAt])
}
```

Generate a migration `sri_core_init`.

### Phase 2 — Env loader & service JWT

`apps/sri-core/src/env.ts`:
Zod schema for every variable. **Only place** that touches `process.env`.

`apps/sri-core/src/auth/service-jwt.ts`:

- `verifyServiceJwt(token)`: HS256, asserts `aud=sri-core`, `iss=api`, `exp` not expired, returns claims.
- Middleware `requireServiceJwt` reads `Authorization: Bearer <jwt>`, attaches `req.service = { companyId }`.

In `apps/api/src/sri/client.ts` (NEW): function `mintServiceJwt({ companyId })`. Each outbound call to sri-core uses a fresh token (≤ 60 s).

### Phase 3 — Routes

`apps/sri-core/src/routes/`:

- `health.ts`: `GET /healthz` returns 200.
- `documents.ts`:
  - `POST /v1/documents/emit` validates `EmitRequestSchema`. Asserts `req.service.companyId === body.companyId`. Computes/receives `claveAcceso` (in v1 the api precomputes — see SPEC-0033). Persists or finds `SriDocument`. Runs the pipeline (stub: skip to AUTORIZADO; real: deferred to later specs). Returns `EmitResponseSchema`.
  - `GET /v1/documents/:claveAcceso/status`: loads by claveAcceso scoped to companyId from JWT; returns the document + events.
  - `POST /v1/documents/:claveAcceso/resend`: re-enqueues based on current state.

### Phase 4 — State machine skeleton

`apps/sri-core/src/lifecycle/transitions.ts`: `canTransition(from, to)` returns boolean per the matrix in SPEC-0026.

`apps/sri-core/src/lifecycle/events.ts`: `recordEvent({ documentId, etapa, estado, mensajes?, durationMs })` writes a row in a transaction with the document update.

(Real signers / SOAP clients are wired in later specs; the skeleton must be ready for them to plug in.)

### Phase 5 — Tests

- Unit: `transitions.test.ts` (allowed vs disallowed transitions).
- Integration: spawn sri-core with a test schema; api mints a JWT; calls `/v1/documents/emit` with a fixture; asserts the document row + events; second call with same claveAcceso returns the existing document (idempotent).
- Negative: missing JWT → 401; mismatched companyId → 403; bad schema → 400.

### Phase 6 — Compose wiring

Update `docker-compose.yml` to set `SERVICE_JWT_SECRET` from `.env` for both services.

## 5. Risks & mitigations

| Risk                             | Mitigation                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Two apps drift on Prisma schema. | One `prisma/schema.prisma`; both apps generate from it; CI verifies.                                                                      |
| JWT secret leak.                 | `.env` only; pulled via env loader; redacted in logger; rotated procedurally.                                                             |
| Replay across tenants.           | Body `companyId` must equal JWT `sub`.                                                                                                    |
| Stub mode accidentally in prod.  | Env validator: if `NODE_ENV==="production"` and `SRI_STUB_MODE==="true"`, fail boot.                                                      |
| State machine inconsistency.     | `canTransition` and `recordEvent` only public path to write; lint warns on direct `prisma.sriDocument.update({ data: { estado: ... } })`. |

## 6. Validation strategy

- All integration tests pass.
- Manual: `curl -X POST http://localhost:3100/v1/documents/emit` with a freshly minted JWT (small helper script) returns 200 + ProblemDetail-free body.
- Stub-mode test: `SRI_STUB_MODE=true`, send a factura fixture, document ends in `AUTORIZADO` with one event of each `etapa` (or just a single synthetic one per the stub plan — document the choice).

## 7. Exit criteria

- All SPEC-0020 ACs pass.
- api ↔ sri-core integration smoke green in compose.
- Prisma migration applied; `prisma migrate status` clean.

## 8. Out of scope

- Real XML build / sign / SOAP — SPECs 0021–0025.
- Polling job for `EN_PROCESO` — SPEC-0026.
- Certificate upload UI — separate spec; SPEC-0021 covers the API endpoint.
