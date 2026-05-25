---
id: PROMPT-0025
spec: SPEC-0025
plan: PLAN-0025
tasks: TASKS-0025
title: Execute TASKS-0025 — SRI SOAP clients
---

# PROMPT-0025 — Execute SRI SOAP clients

You are an autonomous senior engineer experienced in SOAP, XPath, and resilient HTTP clients. Execute **TASKS-0025**: implement hand-rolled SOAP clients for SRI recepción and autorización, including retry/backoff, parsers, and TLS hardening.

---

## 1. Mandatory reading

1. `ai/specs/0025-sri-soap-clients.md` — authoritative.
2. `ai/plans/0025-sri-soap-clients-plan.md`.
3. `ai/tasks/0025-sri-soap-clients-tasks.md`.
4. `docs/sri-facturacion-electronica-ecuador.md` — SOAP endpoints, response shapes, error catalog (mensaje 43 = success).
5. `ai/specs/0024-xades-bes-signer.md` — signed XML feeds recepción.
6. `ai/specs/0006-error-model-and-logging.md` — error model + redaction.
7. `ai/specs/0020-sri-core-service-bootstrap.md` — these clients are exclusively in sri-core.
8. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only HTTP layer, envelopes, parsers, retry wrapper, and two client classes.
- ❌ No `soap` / `node-soap` / `easy-soap-request` libraries.
- ❌ Do NOT disable TLS verification.
- ❌ Do NOT log the SOAP body anywhere.
- ❌ Do NOT retry on business errors (DEVUELTA, NO_AUTORIZADO).

## 3. Stack constraints

- `undici` for HTTP (pin major+minor).
- `@xmldom/xmldom` + `xpath` for parsing.
- TypeScript 5.x strict; ESM only.
- Node 22 with `node:crypto` allowed only for base64 if needed (`Buffer.from(...).toString('base64')` suffices).

## 4. Code quality bar

- Envelope builders return strings; tests compare byte-equality with checked-in fixtures.
- Parsers use `local-name()`-aware XPath everywhere; no hard-coded namespace prefixes.
- Retry budget is short and explicit; jitter added to every delay.
- Classification table for mensaje IDs is in code; mensaje 43 mapped explicitly.
- All clients accept dependencies via constructor (URL, agent) for testability.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/sri-core test --coverage` exits 0; coverage on `soap/*.ts` ≥ 90%.
- Envelope byte-equality with checked-in fixtures.
- Parser tests cover RECIBIDA, DEVUELTA, mensaje 43 → RECIBIDA, AUTORIZADO, EN_PROCESO, NO_AUTORIZADO.
- Retry test simulates two 5xx then 200; total attempts == 3; total elapsed within `schedule`.
- Retry test asserts no retry on DEVUELTA (business).
- Mocked-undici integration test green for both clients.
- A log capture test confirms no SOAP body is emitted.

## 6. Security considerations

- TLS 1.2+ enforced; `rejectUnauthorized: true` everywhere.
- The signed XML may contain customer PII; never log it.
- Log only metadata (`claveAcceso`, `ambiente`, `elapsedMs`, `status`).
- Errors propagate typed (`SriClientError`); the error message may contain mensaje identifiers but never customer data.
- Retries bounded by both attempt count and overall budget; no unbounded retries.
- URLs come from env-loaded constants only; never from request input.

## 7. Deliverables

When TASKS-0025 is green, write `ai/reviews/0025-sri-soap-clients-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage report.
   - Test outputs (envelopes byte-equal; parsers per fixture; retry timing).
   - Mocked client integration test outputs.
4. **Mensaje classification table** — map of common identifier → handling decision.
5. **Retry schedule** — final numbers + jitter + budget.
6. **Deviations from spec/plan**.
7. **Risks observed** — SRI service variability, TLS cert chain at pruebas.
8. **Security review** — confirm §6 verbatim.
9. **Suggested follow-ups** — circuit breaker; metric counters per endpoint; ops alerting on prolonged 5xx.
10. **Sign-off checklist** — SPEC-0025 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0025 boxes ticked.
- All tests green; coverage ≥ 90% on soap/.
- Review file complete.

Begin.
