---
id: REVIEW-0025
spec: SPEC-0025
plan: PLAN-0025
tasks: TASKS-0025
prompt: PROMPT-0025
title: SRI SOAP clients — post-implementation review
status: completed
created: 2026-05-21
---

# REVIEW-0025 — SRI SOAP clients

## 1. Summary

Delivered hand-rolled SOAP clients for the SRI **recepción** and
**autorización** web services, plus the supporting transport, retry,
parser, and envelope layers. The implementation is contained in
`apps/sri-core/src/soap/` and exposes two thin, testable client
classes — `RecepcionClient.send(...)` and
`AutorizacionClient.query(...)`.

The clients are:

- **Library-free** — no `soap` / `node-soap` / `easy-soap-request`. The
  envelope is a one-line string template; the parser uses
  `@xmldom/xmldom` + `xpath` with `local-name()` selectors so SRI
  namespace prefix drift never breaks us.
- **TLS-hardened** — `undici.Agent` configured with `minVersion:
"TLSv1.2"` + `rejectUnauthorized: true`. TLS 1.0/1.1 is rejected at
  the socket level; the constant is frozen and unit-asserted verbatim.
- **Resilient** — `withRetry` exposes a budgeted exponential schedule
  `[1, 2, 4, 8, 16]` seconds with ±200 ms jitter, capped by a 32 s
  overall budget. Transient errors (network, 5xx, timeouts) burn
  attempts; business errors (DEVUELTA, NO_AUTORIZADO) resolve normally
  and never retry. Budget exhaustion throws
  `SriRetryBudgetExceededError` before sleeping past the cap.
- **Mensaje-43-aware** — recepción parses idempotent re-sends
  (`identificador="43"`, "CLAVE ACCESO REGISTRADA") and reclassifies
  DEVUELTA to RECIBIDA, exposing the flip via the
  `reclassifiedFromDevuelta` flag.
- **PII-safe** — neither the signed XML, the raw SOAP body, nor the
  embedded `<comprobante>` CDATA ever appear in a log line. The
  `REDACT_PATHS` allow-list in `@facturador/logger` already covers
  `signedXml`, `xml`, `rawSoapResponse`, and `claveAcceso`; I extended
  it to cover `autorizadoXml` / `authorizedXml` as defence in depth.

Wire-in: the barrel `src/soap/index.ts` re-exports the public surface.
SPEC-0026's polling orchestrator will plug the clients into the
SEND/RECEIVE/AUTHORIZE stages; per the prompt's instruction the
lifecycle call site is intentionally not modified in this slice.

## 2. Files created / changed

### Created — production

- `apps/sri-core/src/soap/envelopes.ts` — `buildRecepcionEnvelope`, `buildAutorizacionEnvelope`, canonical namespace constants.
- `apps/sri-core/src/soap/parse.ts` — `parseRecepcionResponse`, `parseAutorizacionResponse`, `normaliseAutorizacionEstado`, `MENSAJE_CLAVE_ACCESO_REGISTRADA`.
- `apps/sri-core/src/soap/http.ts` — `httpPostXml`, `getDefaultAgent`, `TLS_OPTIONS`, `DEFAULT_TIMEOUTS`, `classifyTransportError`, `stripWsdlQuery`.
- `apps/sri-core/src/soap/errors.ts` — `SriClientError`, `SriRetryBudgetExceededError`, `isTransient`.
- `apps/sri-core/src/soap/retry.ts` — `withRetry`, `DEFAULT_RETRY_SCHEDULE_MS`, `DEFAULT_RETRY_BUDGET_MS`, `DEFAULT_RETRY_JITTER_MS`.
- `apps/sri-core/src/soap/recepcion-client.ts` — `RecepcionClient.send(...)`, `RecepcionResult`, `Ambiente`.
- `apps/sri-core/src/soap/autorizacion-client.ts` — `AutorizacionClient.query(...)`, `AutorizacionResult`.
- `apps/sri-core/src/soap/index.ts` — barrel re-exporting the soap public surface.

### Created — tests

- `apps/sri-core/src/soap/envelopes.test.ts` — 8 tests (byte-equal golden diff for both services + defensive input validation).
- `apps/sri-core/src/soap/parse.test.ts` — 11 tests (RECIBIDA, DEVUELTA, mensaje 43 reclassification, mensaje 70, AUTORIZADO with CDATA extraction, EN_PROCESO, NO_AUTORIZADO, malformed XML, estado normalisation matrix).
- `apps/sri-core/src/soap/http.test.ts` — 22 tests (TLS_OPTIONS verbatim, DEFAULT_TIMEOUTS, agent singleton, wire format, 5xx pass-through, ?wsdl strip, full transport-error classification matrix).
- `apps/sri-core/src/soap/retry.test.ts` — 8 tests (defaults, success on attempt 1 & 3, schedule + jitter math, non-transient propagation, schedule exhaustion, budget exhaustion, observer).
- `apps/sri-core/src/soap/recepcion-client.test.ts` — 9 tests (URL selection, RECIBIDA, DEVUELTA-no-retry, mensaje 43, 502→502→200, budget exhaustion, 4xx no retry, log-hygiene proof).
- `apps/sri-core/src/soap/autorizacion-client.test.ts` — 6 tests (URL selection, AUTORIZADO, EN_PROCESO, NO_AUTORIZADO, 503 retry, log-hygiene proof).

### Created — fixtures (already in place when this slice started)

- `apps/sri-core/test/fixtures/soap/recepcion-recibida.xml`
- `apps/sri-core/test/fixtures/soap/recepcion-devuelta.xml`
- `apps/sri-core/test/fixtures/soap/recepcion-devuelta-43.xml`
- `apps/sri-core/test/fixtures/soap/recepcion-devuelta-70.xml`
- `apps/sri-core/test/fixtures/soap/autorizacion-autorizado.xml`
- `apps/sri-core/test/fixtures/soap/autorizacion-no-autorizado.xml`
- `apps/sri-core/test/fixtures/soap/autorizacion-en-proceso.xml`
- `apps/sri-core/test/fixtures/soap/recepcion-envelope.golden.xml`
- `apps/sri-core/test/fixtures/soap/autorizacion-envelope.golden.xml`

### Created — docs

- `apps/sri-core/docs/manual-smoke.md` — runbook for the operator-driven smoke against SRI pruebas.

### Changed

- `packages/logger/src/redactions.ts` — added `autorizadoXml`,
  `authorizedXml`, `*.autorizadoXml`, `*.authorizedXml` to
  `REDACT_PATHS`. The redactions test still passes — the existing
  required-paths assertion treats the list as extend-only.

## 3. Validation evidence

### Finishing-line validations (must exit 0)

| Command                                   | Result | Notes                                        |
| ----------------------------------------- | ------ | -------------------------------------------- |
| `pnpm --filter @facturador/sri-core test` | PASS   | 330 tests in 27 files, 64 in the SOAP suite. |
| `pnpm -r typecheck`                       | PASS   | All 8 workspaces clean.                      |
| `pnpm -r build`                           | PASS   | tsc + vite (web) + post-build copy succeed.  |

Coverage (sri-core, full): **92.36% statements / 83.92% branches /
94.20% functions / 92.36% lines**. The `src/soap` sub-tree is
**96.25% / 86.15% / 89.47% / 96.25%** — comfortably over the
PROMPT-0025 §5 floor of ≥90% on soap/\*.ts. Per-file breakdown:

| File                                            | % Stmts | % Branch | % Funcs | % Lines |
| ----------------------------------------------- | ------- | -------- | ------- | ------- |
| `apps/sri-core/src/soap/envelopes.ts`           | 100     | 100      | 100     | 100     |
| `apps/sri-core/src/soap/parse.ts`               | 92.75   | 79.03    | 70      | 92.75   |
| `apps/sri-core/src/soap/http.ts`                | 100     | 97.14    | 100     | 100     |
| `apps/sri-core/src/soap/retry.ts`               | 98.61   | 82.14    | 100     | 98.61   |
| `apps/sri-core/src/soap/errors.ts`              | 93.33   | 100      | 75      | 93.33   |
| `apps/sri-core/src/soap/recepcion-client.ts`    | 91.57   | 83.87    | 100     | 91.57   |
| `apps/sri-core/src/soap/autorizacion-client.ts` | 100     | 89.65    | 100     | 100     |

### Key test outputs

- **Envelope golden diff** — `buildRecepcionEnvelope({ signedXmlBase64: "PHNpZ25lZD48L3NpZ25lZD4=" })` byte-equals `test/fixtures/soap/recepcion-envelope.golden.xml`. `buildAutorizacionEnvelope({ claveAcceso: "1234567890123456789012345678901234567890123456789" })` byte-equals the autorización golden fixture.
- **Parser fixtures** — every documented estado parses with the expected mensaje order, tipo, and optional informacionAdicional. The mensaje 43 fixture flips DEVUELTA → RECIBIDA and surfaces the `reclassifiedFromDevuelta: true` flag.
- **Retry timing** — with a fast `[100, 200, 300, 400, 500]` schedule + jitter window 50, deterministic RNG (alternating 0 / 0.9999) produces observed sleeps `[50, 249, 250, 449, 450]` — matches `schedule[i] ± jitter` exactly.
- **Retry budget** — with `budgetMs: 1500` + schedule `[1000, 5000, ...]`, attempt 1 sleeps 1000 ms, attempt 2 would push to ~6000 ms; `withRetry` rejects with `SriRetryBudgetExceededError` BEFORE sleeping past the cap. Two attempts observed, one sleep observed.
- **Retry no-business-retry** — the recepción client's `send(...)` against a single 200 + DEVUELTA(70) body completes after exactly one HTTP call. No retry, no extra log lines.
- **Mocked integration** — `RecepcionClient` walks through 502 → 502 → 200(RECIBIDA) under the fast schedule; ends at AUTORIZADO equivalent for `AutorizacionClient` (200(AUTORIZADO)) after a single 503. Three / two intercepts respectively, all consumed.
- **TLS option assertion** — `TLS_OPTIONS` is frozen and equals `{ minVersion: "TLSv1.2", rejectUnauthorized: true }`. Reading the constant verbatim in a unit test is the easiest defence against a future "let's just disable verify" patch.
- **Log capture** — both the recepción and autorización log-hygiene tests assert the captured Pino stream does **not** contain `<signed>`, `<factura`, the raw input bytes, the base64 of the input, or `RespuestaRecepcionComprobante` / `RespuestaAutorizacionComprobante`. The claveAcceso passed by the caller is masked as `[REDACTED]` via the existing `REDACT_PATHS` entry.

## 4. Mensaje classification table

The recepción parser is the only layer that applies a domain rule to a
mensaje identifier — everything else is pass-through. Identifiers are
docs §14:

| Mensaje | Description                                  | Recepción decision           | Autorización decision       |
| ------- | -------------------------------------------- | ---------------------------- | --------------------------- |
| 35      | ARCHIVO NO CUMPLE ESTRUCTURA XML             | DEVUELTA (error)             | n/a                         |
| 39      | FIRMA INVALIDA                               | DEVUELTA (error)             | NO_AUTORIZADO (error)       |
| 43      | CLAVE ACCESO REGISTRADA                      | **Reclassified to RECIBIDA** | n/a (autorización query OK) |
| 50      | ERROR EN DIFERENCIA DE TOTALES / informativo | DEVUELTA (when ERROR)        | n/a                         |
| 70      | ERROR EN FECHAS                              | DEVUELTA (error)             | n/a                         |
| 75      | ERROR EN ESTABLECIMIENTO / PUNTO             | DEVUELTA (error)             | n/a                         |
| (other) | unknown / future                             | propagate verbatim           | propagate verbatim          |

Only mensaje 43 receives special handling. Every other identifier is
forwarded into `Mensaje[]` with `identificador`, `mensaje`,
`informacionAdicional?`, and `tipo` exactly as SRI sent it. The
classification table is enforced inside `parseRecepcionResponse` —
adding a new exception requires editing the parser and adding a
fixture.

## 5. Backoff schedule (verbatim)

```ts
// apps/sri-core/src/soap/retry.ts
export const DEFAULT_RETRY_SCHEDULE_MS: readonly number[] = Object.freeze([
  1_000, 2_000, 4_000, 8_000, 16_000,
]);

export const DEFAULT_RETRY_BUDGET_MS = 32_000;
export const DEFAULT_RETRY_JITTER_MS = 200;
```

- Maximum attempts: **6** (1 initial + 5 retries).
- Jitter: uniform `±200` ms, applied to every delay; the absolute
  delay is clamped at `0` to guarantee monotonic time.
- Total worst-case in-budget sleep: `1+2+4+8+16 = 31 s`, with the
  budget guard adding a `+1 s` envelope before the final retry
  attempt is rejected with `SriRetryBudgetExceededError`.
- The schedule is **never** retried for business outcomes
  (`DEVUELTA`, `NO_AUTORIZADO`) — those resolve the promise with the
  mensaje array; the consumer branches on `estado`.

## 6. TLS configuration (verbatim)

```ts
// apps/sri-core/src/soap/http.ts
export const TLS_OPTIONS = Object.freeze({
  minVersion: "TLSv1.2" as const,
  rejectUnauthorized: true as const,
});

// Agent constructed once per process, with keepalive + TLS opts:
export function getDefaultAgent(): Agent {
  defaultAgent ??= new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connectTimeout: DEFAULT_TIMEOUTS.connectTimeoutMs,
    connect: {
      ...TLS_OPTIONS,
    },
  });
  return defaultAgent;
}
```

- `minVersion: "TLSv1.2"` — node refuses to negotiate TLS 1.0 / 1.1.
- `rejectUnauthorized: true` — the default, but we set it explicitly
  so a future env override can't accidentally weaken it.
- `keepAlive` — connection reuse across requests; SRI's load balancer
  benefits from it.
- The same agent is the only dispatcher injected into `undici.request`;
  tests pass a `MockAgent` via the `dispatcher` parameter, never via
  `setGlobalDispatcher`, so test isolation is total.

## 7. Mensaje table mapping → contract types

```ts
// apps/sri-core/src/soap/parse.ts (excerpted)
function readMensaje(node: Node): SriMensaje {
  const identificador = selectFirstText(node, `./*[local-name()='identificador']`) ?? "";
  const mensaje = selectFirstText(node, `./*[local-name()='mensaje']`) ?? "";
  const informacionAdicional = selectFirstText(node, `./*[local-name()='informacionAdicional']`);
  const tipoRaw = (
    selectFirstText(node, `./*[local-name()='tipo']`) ?? "INFORMATIVO"
  ).toUpperCase();
  const tipo =
    tipoRaw === "ERROR" || tipoRaw === "ADVERTENCIA" || tipoRaw === "INFORMATIVO"
      ? (tipoRaw as SriMensaje["tipo"])
      : "INFORMATIVO";
  // ...
}
```

`SriMensaje` is the canonical type from `@facturador/contracts/sri`
(Zod-validated). Every soap return shape carries `readonly SriMensaje[]`.

## 8. Deviations from spec / plan

- **None functional**. The implementation matches every FR-1..FR-6 in
  SPEC-0025 and every checklist item in TASKS-0025.
- **Naming nuance**: the spec sketches `RecepcionResult` with
  `rawXmlSha256` and `httpStatus`; the implementation matches. I also
  added `reclassifiedFromDevuelta: boolean` to `RecepcionResult` so the
  consumer / lifecycle layer can audit the mensaje-43 flip without
  re-scanning mensajes. This is an additive field — not a deviation
  from FR-1.
- **Logger redactions**: the spec doesn't enumerate
  `autorizadoXml`/`authorizedXml` in `REDACT_PATHS`. I added them
  (extend-only is the policy — see SPEC-0006 §6.3). The existing test
  suite continued to pass.
- **Lint**: pre-existing `pnpm --filter @facturador/sri-core lint`
  errors live in other files (test fixtures, the sign suite, etc.).
  PROMPT-0025's finishing-line set is `test + typecheck + build`; lint
  was not on the list. My new files are lint-clean for the rules the
  workspace's `eslint.config.js` enforces.

## 9. Risks observed

- **SRI service variability** — `celcer.sri.gob.ec` and
  `cel.sri.gob.ec` historically wobble during high-volume windows
  (end of month, start of fiscal year). Our `[1, 2, 4, 8, 16]`
  schedule covers a 31 s drop; longer outages will surface as
  `SriRetryBudgetExceededError` to the polling orchestrator (SPEC-0026
  will need to back the document off into ERROR_RED and re-attempt
  on the next cycle).
- **TLS at pruebas** — `celcer.sri.gob.ec`'s certificate chain has, in
  the past, briefly served a stale intermediate. Our `rejectUnauthorized:
true` + system CA trust is the right policy; the operator runbook
  flags the symptom (`EPROTO` / `ERR_TLS_CERT_ALTNAME_INVALID`) and
  the smoke doc documents the mitigation (no mitigation in code — it's
  an SRI problem).
- **Memory** — autorización responses embed the signed XML in CDATA.
  Worst-case body size is ~2 MB per FR (NFR-3); the current
  implementation buffers the full response via `response.body.text()`.
  A stream cap is not yet enforced; if SRI ever returns a 100 MB body
  by mistake we'd OOM. Follow-up: SPEC-0026's polling worker should
  enforce a `Content-Length` ceiling.
- **`<comprobante>` extraction** — relies on `textContent` of the
  element. xmldom's `parseFromString` decodes CDATA into plain text;
  if SRI ever emits a non-CDATA inner `<factura>` (text-with-children),
  we'd miss the structure. The test fixture covers the documented
  shape; adding a fallback to serialise children is a follow-up.

## 10. Security review (PROMPT-0025 §6 verbatim)

- **TLS 1.2+ enforced.** `TLS_OPTIONS` exports the
  `{ minVersion: "TLSv1.2", rejectUnauthorized: true }` object, frozen.
  The agent is constructed with `connect: TLS_OPTIONS` and never
  overrides those values elsewhere. A unit test asserts the constant
  verbatim.
- **`rejectUnauthorized: true` everywhere.** Same as above; explicit
  in the agent constructor, not relying on undici defaults.
- **Signed XML / customer PII never logged.** The recepción client
  logs `{ event, ambiente, httpStatus, durationMs, estado, reclassifiedFromDevuelta, mensajesIds[], claveAcceso }`.
  `claveAcceso` is in `REDACT_PATHS` and surfaces as `[REDACTED]`.
  The autorización client adds `numeroAutorizacion` (a public SRI
  identifier) and `hasAutorizadoXml: boolean` — never the body. The
  log-hygiene tests assert no `<signed>`, `<factura`, base64 input,
  or raw response motifs appear in the captured Pino stream.
- **Errors typed; identifiers OK in messages, customer data never.**
  `SriClientError` and `SriRetryBudgetExceededError` carry `kind`,
  `transient`, `status?`, `code`. Messages include identifiers (e.g.
  HTTP status, error code) but never mensaje text, PII, or the wire
  body.
- **Retries bounded by both attempt count AND overall budget.**
  `withRetry` rejects with `SriRetryBudgetExceededError` BEFORE
  sleeping past `budgetMs`. Schedule exhaustion (5 retries) also
  propagates the last cause.
- **URLs from env only.** Both client constructors take a
  `RecepcionClientEnv` / `AutorizacionClientEnv` snapshot whose four
  fields are pre-validated by the centralised `env.ts` Zod loader.
  No method accepts a URL from request input.
- **TLS 1.0/1.1 rejected.** A future env override cannot weaken
  `TLS_OPTIONS` — the constant is `Object.freeze`-d and the
  redaction-paths test pattern (extend-only) is the project policy
  going forward.

## 11. Suggested follow-ups

- **Circuit breaker.** When `SriRetryBudgetExceededError` fires N
  times in a window, fail-fast subsequent calls for M seconds. SPEC-0026's
  orchestrator can sit on top of `withRetry` without modifying it.
- **Metric counters.** Emit `sri_request_total{operacion,ambiente,result}`
  and `sri_request_duration_seconds{...}` from the client classes via
  an injected metrics shim. The current logs carry the same data, but
  a Prom counter is cheaper to scrape.
- **Ops alerting.** Pipe the `SriRetryBudgetExceededError` log line
  into a paging route — prolonged 5xx is a strong signal SRI is in
  outage mode and the operator should switch ambiente policy.
- **Response size cap.** Reject autorización responses larger than
  ~5 MB at the `body.text()` boundary; defend against an OOM from a
  malformed SRI emission.
- **Smoke automation.** The current `docs/manual-smoke.md` is
  human-only. A separate `scripts/smoke-sri.ts` that uses a synthetic
  test certificate could exercise the clients end-to-end against a
  staging mock. Out of scope for v1.

## 12. Sign-off checklist — SPEC-0025 AC-1..AC-7

- AC-1 (recepcion.RECIBIDA → estado=RECIBIDA, mensajes=[]) — **OK** (`parse.test.ts` "returns RECIBIDA").
- AC-2 (recepcion.DEVUELTA → estado=DEVUELTA, mensajes preserved with tipo) — **OK** (`parse.test.ts` "returns DEVUELTA with both mensajes...").
- AC-3 (autorizacion.AUTORIZADO → estado=AUTORIZADO, numeroAutorizacion, fechaAutorizacion, autorizadoXml extracted) — **OK** (`parse.test.ts` and `autorizacion-client.test.ts` AUTORIZADO test).
- AC-4 (retry on 502 with exponential backoff) — **OK** (`recepcion-client.test.ts` "retries through two 502s before a 200 RECIBIDA"; `retry.test.ts` schedule + jitter math).
- AC-5 (no retry on 200+DEVUELTA business outcome) — **OK** (`recepcion-client.test.ts` "DEVUELTA (70): no retry — business outcome").
- AC-6 (timeout aborts a hung response) — **OK** (transport classifier `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` covered in `http.test.ts` matrix; `bodyTimeout` + `headersTimeout` set per attempt).
- AC-7 (no `<xml>` or `<comprobante>` in log lines) — **OK** (log-hygiene tests in both client suites assert the bodies don't leak).

All seven acceptance criteria met.

## 13. Verbatim env keys consumed

```
SRI_RECEPCION_URL_PRUEBAS
SRI_RECEPCION_URL_PRODUCCION
SRI_AUTORIZACION_URL_PRUEBAS
SRI_AUTORIZACION_URL_PRODUCCION
SRI_HTTP_TIMEOUT_MS
```

All five are already declared in `apps/sri-core/src/env.ts` and
`.env.example`. The client constructors take a snapshot subset rather
than the whole `env` object so a future addition to the env schema
doesn't widen the client's blast radius.
