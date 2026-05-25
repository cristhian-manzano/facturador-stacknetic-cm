---
id: PLAN-0033
spec: SPEC-0033
title: Invoice emission orchestrator — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0033 — Invoice emission orchestrator

> Implementation plan for [SPEC-0033](../specs/0033-invoice-emission-orchestrator.md). Depends on PLAN-0020/0022/0026/0030/0031/0032.

## 1. Goal

Implement `POST /api/v1/invoices/:id/emit`:

- Loads the BORRADOR.
- Validates payment sum, customer presence, lines presence.
- Reserves the next `secuencial` (atomic).
- Builds `claveAcceso`.
- Persists invoice with claveAcceso + secuencial + estado=EMITIDO.
- Mints a service JWT, calls sri-core's `/v1/documents/emit` with the canonical request body, awaits the synchronous result.
- Mirrors `SriDocument.estado` onto the Invoice for the list/detail views.
- Reissue flow: a separate `POST /api/v1/invoices/:id/reissue` creates a NEW BORRADOR cloned from the old (after burning the old secuencial).

## 2. Inputs

- [SPEC-0033](../specs/0033-invoice-emission-orchestrator.md) — authoritative.
- [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md), [SPEC-0026](../specs/0026-document-lifecycle-and-jobs.md) — sri-core API.
- [SPEC-0030](../specs/0030-emission-points-and-sequencing.md) — `reserveSecuencial`, `burnSecuencial`.
- [SPEC-0022](../specs/0022-clave-acceso-generator.md) — `buildClaveAcceso`.
- [SPEC-0032](../specs/0032-invoice-domain.md) — invoice domain + compute.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                                          | Rationale                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Synchronous emit for v1: api waits up to ~30 s for AUTORIZADO/DEVUELTA/EN_PROCESO; on EN_PROCESO returns immediately and the api's polling listener (or sri-core's own poll) eventually flips the mirror.                         | Best UX inside the request lifetime; EN_PROCESO yields gracefully. |
| api → sri-core via service JWT minted per call (≤ 60 s).                                                                                                                                                                          | Defence in depth.                                                  |
| Body sent to sri-core: { companyId, claveAcceso, ambiente, tipoEmision, tipoComprobante, secuencial, estab, ptoEmi, fechaEmision, infoXmlInput (the XML input shape from SPEC-0023), allow reuse if claveAcceso already exists }. | Self-contained.                                                    |
| Mirror update: api receives sri-core's response and writes `Invoice.sriEstado`, `numeroAutorizacion`, `fechaAutorizacion`, `mensajesJson`.                                                                                        | Read-side denorm.                                                  |
| api also exposes a tiny `POST /api/v1/invoices/:id/refresh` that re-queries sri-core's status and updates the mirror — used by SPEC-0043.                                                                                         | UX.                                                                |
| Reissue flow: burns the old (companyId,estab,ptoEmi,tipo,secuencial); creates a NEW BORRADOR with the same line items, payments, customer, fechaEmision; new claveAcceso is computed at emit time.                                | Per SRI rules.                                                     |
| On any failure to reach sri-core: leave the invoice EMITIDO with `sriEstado="ERROR_RED"` and return 502; reissue from the UI is the recovery.                                                                                     | Don't leak internal exceptions.                                    |

## 4. Phases

### Phase 1 — Endpoint

`apps/api/src/invoices/emit-handler.ts`:

- Validates state: must be BORRADOR.
- `assertPaymentsMatchTotal` from SPEC-0032.
- In a transaction:
  - `reserveSecuencial`.
  - `codigoNumerico = generateCodigoNumerico()`.
  - `buildClaveAcceso` from invoice fields + reserved secuencial.
  - Update invoice with claveAcceso + secuencial + estado=EMITIDO + emittedAt.
- Outside the transaction:
  - Mint JWT for `companyId`.
  - `sriCoreFetch('/v1/documents/emit', { body })`.
  - Update `Invoice.sriEstado`, `numeroAutorizacion`, `fechaAutorizacion`, `mensajesJson` based on the response.
  - On network failure: persist `sriEstado="ERROR_RED"`; log + audit; return 502 with ProblemDetail.

### Phase 2 — Reissue

`apps/api/src/invoices/reissue-handler.ts`:

- Source invoice must be `EMITIDO` with `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}`.
- In a transaction:
  - `burnSecuencial` for the old.
  - Insert a new Invoice with `estado="BORRADOR"`, same customerId, same lines/payments/adicionales (cloned), fechaEmision = today (Ecuador local).
- Return 201 with `{ newInvoiceId }`.

### Phase 3 — Refresh

`apps/api/src/invoices/refresh-handler.ts`:

- `POST /api/v1/invoices/:id/refresh`:
  - Mints JWT; calls `GET /v1/documents/:claveAcceso/status` in sri-core.
  - Updates mirror fields.
  - Returns the new mirror state.

### Phase 4 — Tests

- Integration:
  - Happy path: emit → AUTORIZADO (sri-core in stub mode); invoice mirror updated.
  - EN_PROCESO path: emit returns EN_PROCESO; refresh later transitions to AUTORIZADO.
  - DEVUELTA path: mensajes captured; invoice estado stays EMITIDO with `sriEstado=DEVUELTA`; reissue creates a new BORRADOR.
  - Network failure path: stub sri-core returns 500; api persists ERROR_RED; reissue or retry possible.
  - Idempotency: calling emit twice on the same invoice returns the current state (don't re-reserve secuencial; don't double-call sri-core).
  - Payment mismatch: emit returns 422 with `code:"payments_mismatch"`.

## 5. Risks & mitigations

| Risk                                                            | Mitigation                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Secuencial reserved but sri-core never reached → number burned. | Acceptable per SRI rules; UX guides user to reissue.                                                |
| Race: two emit clicks.                                          | Lock the invoice row in the open transaction; second call sees `estado=EMITIDO` and short-circuits. |
| sri-core temporarily unreachable.                               | Retry policy upstream; api translates to 502 with clear message.                                    |
| JWT exposed in logs.                                            | Already redacted by logger; emit handler never logs token.                                          |
| Reissue clones too eagerly.                                     | Only allowed when sriEstado in {DEVUELTA, NO_AUTORIZADO}.                                           |

## 6. Validation strategy

- All integration tests pass.
- End-to-end smoke with stub-mode sri-core: emit → AUTORIZADO observed in the DB on the api side.
- Reissue creates a new BORRADOR with a different claveAcceso when emitted again.

## 7. Exit criteria

- All SPEC-0033 ACs pass.
- Mirror fields populated correctly across paths.

## 8. Out of scope

- RIDE PDF — later.
- Anulación at SRI — later.
- Email delivery to receptor — later.
