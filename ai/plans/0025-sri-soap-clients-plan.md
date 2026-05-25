---
id: PLAN-0025
spec: SPEC-0025
title: SRI SOAP clients (recepción + autorización) — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0025 — SRI SOAP clients

> Implementation plan for [SPEC-0025](../specs/0025-sri-soap-clients.md). Depends on PLAN-0024.

## 1. Goal

Implement two **hand-rolled** SOAP clients in `apps/sri-core`:

- **Recepción** — accepts a signed XML; returns RECIBIDA / DEVUELTA + mensajes.
- **Autorización** — given a claveAcceso, returns AUTORIZADO / NO_AUTORIZADO / EN_PROCESO + mensajes + (when AUTORIZADO) the wrapped `autorizado` XML.

Properties:

- TLS 1.2+ only.
- Retries with exponential backoff for transient network/5xx (limited to a few rounds).
- Timeout per call (e.g., 20 s).
- Pure XML parsing via XPath with `local-name()` to be namespace-agnostic.
- Error normalisation to `SriMensaje` shape.
- No `soap` library — too much surface area, prefer explicit envelopes.

## 2. Inputs

- [SPEC-0025](../specs/0025-sri-soap-clients.md) — authoritative.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — SOAP endpoints, envelope shapes, error catalog (mensaje ID 43 = "CLAVE ACCESO REGISTRADA" treated as success).
- [SPEC-0021](../specs/0021-certificate-management.md) — not used here unless mutual TLS later (out of scope for v1).

## 3. Architecture decisions

| Decision                                                                                                                                                                                             | Rationale                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| HTTP via **undici** with explicit TLS options (`minVersion: 'TLSv1.2'`, `rejectUnauthorized: true`).                                                                                                 | Modern HTTP/1.1 + control; pin a version.                  |
| Envelopes assembled by string templates; signed XML embedded base64 in recepción.                                                                                                                    | Predictable bytes; avoid surprises.                        |
| Parser uses `@xmldom/xmldom` + `xpath` with `local-name()` selectors.                                                                                                                                | Namespace-agnostic; survives SOAP prefix drift.            |
| Retry policy: classify error → transient vs business. Only retry transient (timeouts, `ECONNRESET`, 5xx) up to 5 attempts with `[1, 2, 4, 8, 16]` seconds backoff, capped by overall budget (~30 s). | Avoids retry storms; never retries business errors.        |
| Timeout per attempt 20 s (`bodyTimeout: 20_000, headersTimeout: 5_000`).                                                                                                                             | Reasonable SRI window.                                     |
| Endpoint URLs from env per environment (`ambiente`): pruebas vs producción.                                                                                                                          | Switch via DB-driven ambiente, but URLs always env-driven. |
| Response parsing tolerant of mensajes ID 43 ("CLAVE ACCESO REGISTRADA") — treat as successful recepción (idempotent re-send).                                                                        | Per SRI behaviour.                                         |
| Errors normalised to `SriMensaje[]`; service raises a typed `SriClientError` with classification (`transient`/`business`).                                                                           | One shape downstream.                                      |
| No global state; clients accept env / overrides via constructor parameters; integration tests inject a `nock`/`undici-mock-agent`.                                                                   | Testable.                                                  |

## 4. Phases

### Phase 1 — HTTP layer

`apps/sri-core/src/soap/http.ts`:

- `httpPostXml({ url, body, timeoutMs }): { status, text }` using undici with TLS opts and timeouts.

### Phase 2 — Envelope builders

`apps/sri-core/src/soap/envelopes.ts`:

- `buildRecepcionEnvelope({ signedXmlBase64 })`.
- `buildAutorizacionEnvelope({ claveAcceso })`.

### Phase 3 — Response parsers

`apps/sri-core/src/soap/parse.ts`:

- `parseRecepcionResponse(xml): { estado: "RECIBIDA"|"DEVUELTA", mensajes: SriMensaje[] }`.
- `parseAutorizacionResponse(xml): { estado: "AUTORIZADO"|"NO_AUTORIZADO"|"EN_PROCESO", numeroAutorizacion?, fechaAutorizacion?, autorizadoXml?, mensajes }`.

### Phase 4 — Client classes

`apps/sri-core/src/soap/recepcion-client.ts`:

- `RecepcionClient` with `send(signedXml): Result`. Internally: encode base64, build envelope, post, parse, classify.

`apps/sri-core/src/soap/autorizacion-client.ts`:

- `AutorizacionClient` with `query(claveAcceso): Result`. Same shape.

### Phase 5 — Retry/backoff wrapper

`apps/sri-core/src/soap/retry.ts`:

- `withRetry(fn, { isTransient, schedule, budgetMs })`.
- Used internally by the client classes for `httpPostXml`.

### Phase 6 — Tests

- Unit:
  - Envelopes: golden expected bodies for given inputs.
  - Parsers: feed canned SRI responses (positive + negative + EN_PROCESO + mensaje 43) and assert outputs.
  - Retry: simulate transient errors, ensure backoff schedule honoured; assert business error doesn't retry.
- Integration (with `undici-mock-agent`):
  - End-to-end RecepcionClient with mocked endpoint.

### Phase 7 — Manual smoke against SRI pruebas (optional, gated)

A doc page describes how to run a manual smoke against `https://celcer.sri.gob.ec/...` from a developer workstation with a real test cert. **Not part of CI**; documented for ops.

## 5. Risks & mitigations

| Risk                                       | Mitigation                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| SRI service outage masks bug in our retry. | Retry only on transient + small budget; integration tests cover non-retryable paths. |
| XML parser drift (xmldom).                 | Pin version; XPath uses local-name().                                                |
| TLS cert issues with SRI.                  | `rejectUnauthorized: true`; document the SRI cert chain trust expectation.           |
| Hidden mensajes treated as success.        | Comprehensive parse tests; codify mensaje classification table.                      |

## 6. Validation strategy

- All envelope/parse/retry tests pass.
- Mocked integration tests pass.
- Manual smoke (operator) returns RECIBIDA from SRI pruebas.

## 7. Exit criteria

- All SPEC-0025 ACs pass.
- No `soap` library introduced.
- Retries non-aggressive and never on business errors.

## 8. Out of scope

- Polling / cron — SPEC-0026.
- Contingencia (offline batch) handling — separate spec later.
- Mutual TLS / cert-bound transport — out for v1.
