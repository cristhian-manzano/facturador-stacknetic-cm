---
id: TASKS-0025
spec: SPEC-0025
plan: PLAN-0025
title: SRI SOAP clients — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0025 — SRI SOAP clients

> Checklist for [SPEC-0025](../specs/0025-sri-soap-clients.md) + [PLAN-0025](../plans/0025-sri-soap-clients-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `soap`/`node-soap` library. Hand-rolled envelopes only.
- ❌ Never retry a business error (DEVUELTA / NO_AUTORIZADO). Only retry transient errors (network, 5xx).
- ❌ Never disable TLS verification (`rejectUnauthorized: true` always).
- ❌ Never log the full SOAP body in production. The body may contain customer PII (signed XML).
- ✅ XPath selectors use `local-name()` to ignore SOAP envelope namespaces.
- ✅ Mensaje ID 43 ("CLAVE ACCESO REGISTRADA") on recepción is treated as success (idempotent).

## 1. HTTP layer

- [ ] **1.1** Add dep `undici@^6` to `apps/sri-core`.
      **Validate**: install succeeds.

- [ ] **1.2** `apps/sri-core/src/soap/http.ts`:
  - `httpPostXml({ url, body, timeoutMs })` using a long-lived `Agent` with `connect: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }` and per-request `bodyTimeout`, `headersTimeout`.
  - Returns `{ status, text }`; throws `NetworkError` (typed) on connection issues.
    **Validate**: unit test mocks undici, asserts headers `Content-Type: text/xml; charset=utf-8`, asserts TLS opts are set.

## 2. Envelopes

- [ ] **2.1** `apps/sri-core/src/soap/envelopes.ts`:
  - `buildRecepcionEnvelope({ signedXmlBase64 })` returns SOAP 1.1/1.2 envelope per `docs/sri-...`. (Use the version SRI documents; pin in code.)
  - `buildAutorizacionEnvelope({ claveAcceso })` likewise.
    **Validate**: golden expected bodies committed under `apps/sri-core/test/fixtures/soap/*.xml`; tests assert exact byte equality.

## 3. Parsers

- [ ] **3.1** `apps/sri-core/src/soap/parse.ts`:
  - `parseRecepcionResponse(xml)`:
    - Returns `{ estado: "RECIBIDA"|"DEVUELTA", mensajes: SriMensaje[] }`.
    - If estado is "DEVUELTA" but every mensaje is non-error (informativo), still classify as DEVUELTA per SRI docs.
    - If estado is "DEVUELTA" with a mensaje `identificador="43"`, return RECIBIDA (idempotent re-send acknowledged).
  - `parseAutorizacionResponse(xml)`:
    - Returns `{ estado, numeroAutorizacion?, fechaAutorizacion?, autorizadoXml?, mensajes }`.
    - `autorizadoXml` is the inner `<comprobante>` element captured as a CDATA-decoded string when AUTORIZADO.
      **Validate**: fixture-driven tests:
    - Positive recepción (RECIBIDA + 0 mensajes).
    - Negative recepción (DEVUELTA + 2 mensajes).
    - Mensaje 43 (RECIBIDA classification confirmed).
    - Positive autorización (AUTORIZADO + autorizadoXml extracted, with embedded comprobante intact byte-for-byte except CDATA wrapping).
    - EN_PROCESO autorización.
    - NO_AUTORIZADO autorización with mensajes.

## 4. Retry wrapper

- [ ] **4.1** `apps/sri-core/src/soap/retry.ts`:
  - `withRetry(fn, { isTransient, schedule, budgetMs })`:
    - `schedule = [1000, 2000, 4000, 8000, 16000]` (configurable).
    - Total `budgetMs` cap (default 30 s).
    - Aborts when budget exceeded.
  - Adds jitter (±200 ms) per delay to avoid synchronised retry storms.
    **Validate**: unit test simulates failures (timeout, then success); asserts attempt count and total elapsed within bounds.

## 5. Client classes

- [ ] **5.1** `RecepcionClient`:

  - `send(signedXml)`:
    - base64-encode signed XML.
    - Build envelope.
    - `withRetry(() => httpPostXml(...))` with `isTransient = (err|status5xx)`.
    - Parse response.
    - Return `{ estado, mensajes }`.
      **Validate**: integration test with `undici-mock-agent`:
    - Mock 5xx → expect retry; eventual success.
    - Mock 200 with DEVUELTA → no retry.
    - Mock 200 with mensaje 43 → RECIBIDA.

- [ ] **5.2** `AutorizacionClient`:
  - `query(claveAcceso)`:
    - Build envelope.
    - `withRetry(...)`.
    - Parse response.
      **Validate**: mocked integration test for AUTORIZADO, EN_PROCESO, NO_AUTORIZADO.

## 6. URL config

- [ ] **6.1** `RecepcionClient` and `AutorizacionClient` accept `ambiente: "1"|"2"` and read URLs from env (`SRI_RECEPCION_URL_PRUEBAS|PROD`, `SRI_AUTORIZACION_URL_PRUEBAS|PROD`).
      **Validate**: unit test passes both ambientes and asserts URL selection.

## 7. Logging discipline

- [ ] **7.1** The clients log at `info` level: `{ requestId, claveAcceso, ambiente, elapsedMs, status }` — but NOT the SOAP body or any mensaje containing customer PII.
  - Errors logged at `warn` with `mensajes.map(m => ({ identificador: m.identificador, tipo: m.tipo }))` only (no `mensaje` text in logs).
  - Adjust REDACT_PATHS if necessary.
    **Validate**: a log capture test asserts no SOAP body in output.

## 8. Manual smoke (operator doc)

- [ ] **8.1** Add `apps/sri-core/docs/manual-smoke.md` describing how to: (a) export a JWT, (b) call `/v1/documents/emit` with a fixture, (c) optionally run the client classes from a Node REPL against pruebas, with the operator's real test cert.
      **Validate**: file present.

## 9. Acceptance criteria

- [ ] AC-1: Two clients (Recepción, Autorización) talk SOAP without a heavy library.
- [ ] AC-2: TLS 1.2+ enforced; verification on; configurable URLs by ambiente.
- [ ] AC-3: Retries with exponential backoff + jitter only for transient errors; never for business errors.
- [ ] AC-4: Mensaje 43 on recepción classified as success.
- [ ] AC-5: XPath selectors use `local-name()` and tolerate namespace prefix drift.
- [ ] AC-6: No SOAP body or PII in logs.
- [ ] AC-7: Unit + mocked integration tests green.

## 10. Definition of Done

- All boxes ticked; all tests green; manual smoke doc present.
- Review file `ai/reviews/0025-sri-soap-clients-review.md` written.
