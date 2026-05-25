---
id: TASKS-0033
spec: SPEC-0033
plan: PLAN-0033
title: Invoice emission orchestrator — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0033 — Invoice emission orchestrator

> Checklist for [SPEC-0033](../specs/0033-invoice-emission-orchestrator.md) + [PLAN-0033](../plans/0033-invoice-emission-orchestrator-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never reuse a secuencial. Reissue burns the old.
- ❌ Never call sri-core without a freshly minted service JWT.
- ❌ Never expose JWTs, claveAcceso, or mensajes in logs (logger handles redaction; do not introduce new log lines that contain sensitive payloads).
- ❌ Never accept `claveAcceso` from the user input — always computed server-side.
- ✅ Calling emit twice on the same invoice is a no-op (idempotent).
- ✅ Reissue is allowed only when `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}`.

## 1. Emit handler

- [ ] **1.1** `POST /api/v1/invoices/:id/emit` (`invoice.emit`):
  - Load invoice scoped to `req.companyId`. 404 if missing.
  - If `estado === "EMITIDO"`: return current mirror state idempotently (200) without re-reserving or re-calling sri-core.
  - Else assert `estado === "BORRADOR"`; assert at least one line; assert payments sum ≈ importeTotal (±0.01); assert customerId present.
  - In a transaction:
    - `reserveSecuencial({ companyId, estab, ptoEmi, tipoComprobante: "01" })`.
    - `codigoNumerico = generateCodigoNumerico()`.
    - `claveAcceso = buildClaveAcceso({ fechaEmision, codDoc:"01", ruc, ambiente, estab, ptoEmi, secuencial, codigoNumerico, tipoEmision:"1" })`.
    - Update invoice: `secuencial`, `claveAcceso`, `estado="EMITIDO"`, `emittedAt=now()`.
  - Outside the transaction:
    - Mint JWT for `companyId`.
    - POST sri-core `/v1/documents/emit` with the canonical request body.
    - On success: update mirror (`sriEstado`, `numeroAutorizacion`, `fechaAutorizacion`, `mensajesJson`).
    - On network failure: set `sriEstado="ERROR_RED"`, audit, return 502 with ProblemDetail.
      **Validate**: see §4.

## 2. Reissue handler

- [ ] **2.1** `POST /api/v1/invoices/:id/reissue` (`invoice.reissue`):
  - Load source invoice; verify `estado === "EMITIDO"` AND `sriEstado ∈ {DEVUELTA, NO_AUTORIZADO}`. Else 422 `code:"reissue_not_allowed"`.
  - In a transaction:
    - `burnSecuencial({ companyId, estab, ptoEmi, tipoComprobante:"01", secuencial, reason:"reissue" })`.
    - Create a new Invoice with `estado="BORRADOR"`, same customerId, same lines/payments/adicionales (cloned, new `id`s), `fechaEmision=today`.
  - Return 201 `{ newInvoiceId }`.
    **Validate**: see §4.

## 3. Refresh handler

- [ ] **3.1** `POST /api/v1/invoices/:id/refresh` (`invoice.read`):
  - Mint JWT; call sri-core `GET /v1/documents/:claveAcceso/status`.
  - Update mirror.
  - Return the mirror state.
    **Validate**: integration test asserts mirror state updates after a status change in sri-core.

## 4. Integration tests

- [ ] **4.1** Happy path (stub mode sri-core):

  - Create draft → emit → assert `estado=EMITIDO`, `sriEstado=AUTORIZADO`, `numeroAutorizacion` set, `claveAcceso` unique, secuencial assigned.
    **Validate**: pass.

- [ ] **4.2** Idempotent emit:

  - Call emit twice; second call returns same body; secuencial unchanged; no new SriDocument event row.
    **Validate**: pass.

- [ ] **4.3** Payment mismatch:

  - Payment total off by `0.02` from importeTotal → 422 `code:"payments_mismatch"`; invoice remains BORRADOR.
    **Validate**: pass.

- [ ] **4.4** DEVUELTA path (mock sri-core stub to return DEVUELTA with mensajes):

  - emit returns 200; invoice estado=EMITIDO; sriEstado=DEVUELTA; mensajes populated.
  - Reissue: creates new BORRADOR; old invoice unchanged; `BurnedSecuencial` row exists.
    **Validate**: pass.

- [ ] **4.5** Network failure:

  - Stub sri-core to throw `ECONNRESET`. emit returns 502; invoice estado=EMITIDO; sriEstado=ERROR_RED.
  - Subsequent refresh re-queries: if sri-core back, mirror updates.
    **Validate**: pass.

- [ ] **4.6** EN_PROCESO path:
  - Stub sri-core to return EN_PROCESO. emit returns 200; sriEstado=EN_PROCESO.
  - Refresh later when stub returns AUTORIZADO → mirror updates.
    **Validate**: pass.

## 5. Audit

- [ ] **5.1** Audit rows: `invoice.emit.attempt`, `invoice.emit.success`, `invoice.emit.failure (reason)`, `invoice.reissue`, `invoice.refresh`. Never include JWT or claveAcceso in the audit payload other than `claveAcceso` as a non-sensitive identifier (it is publicly visible on the printed RIDE in production).
      **Validate**: rows present.

## 6. Security checks

- [ ] **6.1** `claveAcceso` must NEVER be accepted from request input. Confirm: a body field `claveAcceso` is silently ignored or rejected (return 400 if present). Test it.
      **Validate**: test asserts 400 (or that the value is overwritten by the server-computed one — pick one, document, test).

- [ ] **6.2** Service JWT mint includes only `companyId` in `sub` — never user data.
      **Validate**: token decode shows expected claims.

## 7. Acceptance criteria

- [ ] AC-1: Emit transitions BORRADOR → EMITIDO atomically with secuencial reservation + claveAcceso.
- [ ] AC-2: SRI mirror fields updated post-emit per response.
- [ ] AC-3: Idempotent: second emit is a no-op.
- [ ] AC-4: Reissue burns old secuencial and creates a new BORRADOR.
- [ ] AC-5: Network failure leaves the invoice EMITIDO with ERROR_RED and returns 502.
- [ ] AC-6: Refresh updates mirror from sri-core's status.
- [ ] AC-7: Payment mismatch rejects emit at 422.

## 8. Definition of Done

- All boxes ticked; all integration tests green.
- Review file `ai/reviews/0033-invoice-emission-orchestrator-review.md` written.
