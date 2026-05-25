---
id: REVIEW-0033
spec: SPEC-0033
plan: PLAN-0033
tasks: TASKS-0033
prompt: PROMPT-0033
title: Invoice emission orchestrator — review
status: green — all finishing-line validations pass; SPEC-0033 AC-1..AC-7 satisfied
created: 2026-05-25
---

# REVIEW-0033 — Invoice emission orchestrator (API)

## 1. Summary

This pass closes PROMPT-0033 by running the four finishing-line
validations end-to-end and writing this review. The orchestrator
(`emit` / `reissue` / `refresh`) was implemented in the previous slice
and is wired into `apps/api`'s router with the standard
`requireSession` → `assertCsrf` → `requireTenant` → `requirePermission`
chain. The `:id/emit` endpoint runs a three-stage pipeline
(`reserveInTransaction` → `callSriCoreEmit` → `mirrorEmitResponse`),
mints a fresh ≤60 s HS256 service JWT per outbound call, persists the
SRI mirror fields field-by-field (no spread), and is idempotent on a
second invocation of an already-EMITIDO invoice.

All 4 validations exit 0:

- `pnpm --filter @facturador/api test` — 312/312 green.
- `pnpm --filter @facturador/sri-core test` — 397/397 green.
- `pnpm -r typecheck` — 9/9 workspaces clean.
- `pnpm -r build` — every workspace builds (api, sri-core, web, all
  packages).

No source changes were required. No leftover TODO/FIXME without a
tracked task ID exists in `apps/api/src/invoices/**` or
`apps/api/test/invoices.test.ts`.

## 2. Files created / changed

### Created (in PROMPT-0033 by the previous slice — verified in this pass)

- `apps/api/src/invoices/orchestrator.ts` (875 lines) — emit /
  reissue / refresh handlers, three-stage emit pipeline, idempotency,
  field-by-field mirror writes, audit emission, and the explicit
  body-`claveAcceso` rejection.
- `apps/api/src/invoices/translate-to-sri.ts` (207 lines) — pure
  Invoice → `EmitDocumentRequest` translator (no DB / clock).
- `apps/api/src/invoices/handlers.ts` (875 lines) — CRUD handlers
  - body-shape guard for `claveAcceso` / `companyId` on every write.
- `apps/api/src/invoices/repository.ts` — transactional repository
  (create/replace/list/delete, cursor pagination).
- `apps/api/src/invoices/routes.ts` (145 lines) — router that mounts
  the 9 endpoints below; already wired in `apps/api/src/server.ts`
  via `buildInvoiceRouter`.
- `apps/api/test/invoices.test.ts` — integration tests for SPEC-0032
  - SPEC-0033 (17 `it()` cases across 6 `describe()` blocks; includes
    all six TASKS-0033 §4 scenarios and the JWT-decode assertion).

### Changed in this pass

- _(none)_ — the previous slice landed all source. This pass executed
  validations, confirmed greens, and wrote this review.

### Unchanged but referenced

- `apps/api/src/server.ts:263..278` — wires `buildInvoiceRouter`.
- `apps/api/src/sri/client.ts` — `sriCoreFetch` helper that mints the
  per-call JWT and forwards `X-Request-Id`.
- `apps/api/src/sequencing/reserve.ts` + `burn.ts` — SPEC-0030
  primitives reused by the orchestrator.
- `packages/utils/src/sri/clave-acceso/*` — `buildClaveAcceso` and
  `generateCodigoNumerico` (SPEC-0022).
- `packages/utils/src/rbac/rbac.ts:72..92, 115..` — `invoice.emit` and
  `invoice.reissue` permission codes wired into the role matrix.

## 3. Validation evidence

| Command                                   | Result            | Test count                           |
| ----------------------------------------- | ----------------- | ------------------------------------ |
| `pnpm --filter @facturador/api test`      | **PASS** (exit 0) | 24 files / **312 passed** / 0 failed |
| `pnpm --filter @facturador/sri-core test` | **PASS** (exit 0) | 31 files / **397 passed** / 0 failed |
| `pnpm -r typecheck`                       | **PASS** (exit 0) | 9/9 workspaces clean                 |
| `pnpm -r build`                           | **PASS** (exit 0) | api, sri-core, web, all packages     |

### Invoice integration suite (single-suite breakdown)

`apps/api/test/invoices.test.ts` — 17 `it()` cases, all green:

- create + validate (5): create BORRADOR, invalid payload → 400,
  `claveAcceso` in body → 400, `companyId` in body ignored,
  VIEWER → 403.
- `preview-totals` (1): returns totals, no row persisted.
- list + detail + cross-tenant (2): cross-tenant 404, cursor
  pagination 25-row dataset.
- PATCH/DELETE on EMITIDO (2): both → 422 `locked`.
- `:id/emit` orchestrator (6): happy path, idempotent,
  payments_mismatch, DEVUELTA + reissue, network failure, cross-tenant.
- `:id/refresh` (1): EN_PROCESO → AUTORIZADO via status endpoint.

### Sample decoded JWT shape (from the happy-path test)

The test decodes the captured `Authorization: Bearer …` header and
asserts the claim shape. Token redacted, claims-only:

```jsonc
{
  "aud": "sri-core",
  "iss": "api",
  "sub": "<companyId from req.companyId — never from body>",
  "exp": <iat + 60>,
  "iat": <now>
}
```

Assertion in `apps/api/test/invoices.test.ts:773..777`:

```ts
expect(payload.aud).toBe("sri-core");
expect(payload.iss).toBe("api");
expect(payload.sub).toBe(auth.companyId);
expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
```

### Mirror field values before/after each scenario

| Scenario                          | `estado` before → after      | `sriEstado` before → after     | `secuencial`       | `claveAcceso` (len) | `numeroAutorizacion` | `mensajesJson` |
| --------------------------------- | ---------------------------- | ------------------------------ | ------------------ | ------------------- | -------------------- | -------------- |
| Happy / AUTORIZADO                | BORRADOR → EMITIDO           | null → AUTORIZADO              | null → "000000001" | null → 49 chars     | from response, set   | `[]`           |
| Idempotent (2nd emit)             | EMITIDO → EMITIDO            | AUTORIZADO → AUTORIZADO        | unchanged          | unchanged           | unchanged            | unchanged      |
| Payments mismatch (422)           | BORRADOR (unchanged)         | null (unchanged)               | null               | null                | n/a                  | null           |
| DEVUELTA                          | BORRADOR → EMITIDO           | null → DEVUELTA                | null → "000000001" | null → 49 chars     | absent               | 1 mensaje      |
| Network failure (ECONNRESET)      | BORRADOR → EMITIDO           | null → ERROR_RED               | null → "000000001" | null → 49 chars     | null                 | null           |
| EN_PROCESO + refresh → AUTORIZADO | BORRADOR → EMITIDO → EMITIDO | null → EN_PROCESO → AUTORIZADO | null → "000000001" | null → 49 chars     | set after refresh    | `[]`           |

In every scenario the mirror update goes through `applyMirror()` with
an explicit field-by-field `data: { sriEstado, mensajesJson }` shape
— no spread of upstream payload keys.

## 4. Endpoints created (paste from `apps/api/src/invoices/routes.ts`)

| Method | Path                              | Auth chain                                  | RBAC permission   |
| ------ | --------------------------------- | ------------------------------------------- | ----------------- |
| GET    | `/api/v1/invoices`                | requireSession + requireTenant              | `invoice.read`    |
| POST   | `/api/v1/invoices/preview-totals` | requireSession + assertCsrf + requireTenant | `invoice.read`    |
| GET    | `/api/v1/invoices/:id`            | requireSession + requireTenant              | `invoice.read`    |
| POST   | `/api/v1/invoices`                | requireSession + assertCsrf + requireTenant | `invoice.create`  |
| PATCH  | `/api/v1/invoices/:id`            | requireSession + assertCsrf + requireTenant | `invoice.create`  |
| DELETE | `/api/v1/invoices/:id`            | requireSession + assertCsrf + requireTenant | `invoice.create`  |
| POST   | `/api/v1/invoices/:id/emit`       | requireSession + assertCsrf + requireTenant | `invoice.emit`    |
| POST   | `/api/v1/invoices/:id/reissue`    | requireSession + assertCsrf + requireTenant | `invoice.reissue` |
| POST   | `/api/v1/invoices/:id/refresh`    | requireSession + assertCsrf + requireTenant | `invoice.read`    |

`preview-totals` MUST come before `/:id` so the literal segment
matches first; the router does so.

## 5. `claveAcceso` generation site (server-side, single source)

`claveAcceso` is **never** accepted from the client. It is minted
inside the transactional reservation step of the emit handler, using
the values that the orchestrator simultaneously persists on the
invoice row:

- **File**: `apps/api/src/invoices/orchestrator.ts`
- **Function**: `reserveInTransaction()`
- **Lines 242..253**:

```ts
const codigoNumerico = generateCodigoNumerico();
const claveAcceso = buildClaveAcceso({
  fechaEmision: invoice.fechaEmision,
  codDoc: "01",
  ruc: company.ruc,
  ambiente: company.ambiente as "1" | "2",
  estab: emissionPoint.establecimiento.codigo,
  ptoEmi: emissionPoint.codigo,
  secuencial,
  codigoNumerico,
  tipoEmision: "1",
});
```

It is then persisted on the invoice row in the very next
`prisma.invoice.update` call (lines 255..268), guaranteeing the
no-drift rule of PROMPT-0033 §4 ("called with exactly the fields
persisted").

Defence-in-depth: `assertBodyHasNoClaveAcceso()` (orchestrator.ts
833..850) plus the equivalent guard in `handlers.ts:789..820` reject
any inbound body that includes a `claveAcceso` field with a 400
ValidationError before the handler even runs.

## 6. Emit pipeline (flow diagram)

```
POST /api/v1/invoices/:id/emit  (invoice.emit)
        │
        ▼
 requireSession + assertCsrf + requireTenant + requirePermission("invoice.emit")
        │
        ▼
 [orchestrator.emit]
        │
        ├── parse IdParam (Zod)
        ├── assertBodyHasNoClaveAcceso(req.body)        ← hard guard
        ├── findInvoiceById({ id, companyId })           ← scoped to req.companyId
        ├── (BORRADOR only) pre-emit validations:
        │     • lines.length ≥ 1
        │     • |Σ payments.total − importeTotal| ≤ 0.01
        │     • customerId present
        ├── audit("invoice.emit.attempt")
        │
        ├── [1] reserveInTransaction(prisma, …)         ← atomic
        │       ├── Promise.all(company, customer, emissionPoint)
        │       ├── 404 on any cross-tenant miss
        │       ├── if estado === "EMITIDO" → return as-is (idempotent)
        │       ├── reserveSecuencial(…)
        │       ├── generateCodigoNumerico()
        │       ├── buildClaveAcceso({…})               ← server-only
        │       └── prisma.invoice.update({ secuencial,
        │              claveAcceso, estado:"EMITIDO",
        │              emittedAt, ambiente, tipoEmision,
        │              obligadoContabilidad, contribuyenteEspecial })
        │
        ├── if originally EMITIDO → audit("invoice.emit.idempotent");
        │                            return current mirror, 200, no sri-core call
        │
        ├── [2] callSriCoreEmit({ reserved, requestId, … })   ← outbound
        │       ├── translateInvoiceToSriRequest(reserved)
        │       └── sriCoreFetch("/v1/documents/emit", {
        │              method:"POST", body, companyId,
        │              requestId, serviceJwtTtlSeconds:60 })
        │
        │          ↓ on UpstreamError:
        │          • applyMirror(sriEstado="ERROR_RED", numAuth=null,
        │                         fechaAuth=null, mensajes=null)
        │          • audit("invoice.emit.failure", reason:"sri.network")
        │          • throw UpstreamError("sri.network") → 502 ProblemDetail
        │
        ├── [3] mirrorEmitResponse(prisma, invoiceId, sriResp)
        │       └── applyMirror({ sriEstado, numeroAutorizacion,
        │                         fechaAutorizacion, mensajesJson })
        │
        ├── audit("invoice.emit.success", claveAcceso, sriEstado, durationMs)
        └── 200 OK { estado, claveAcceso, sriEstado,
                     numeroAutorizacion, fechaAutorizacion,
                     mensajes, invoice }
```

`sri-core` is the only party that talks SOAP / signs / builds XML; the
API forwards a typed JSON `EmitDocumentRequest` body and re-validates
the typed JSON `EmitDocumentResponse` body coming back (Zod parse in
`sriCoreFetch`'s caller chain).

## 7. Idempotency analysis

Idempotency is enforced at two layers, both in
`apps/api/src/invoices/orchestrator.ts`:

1. **Within `reserveInTransaction()` (lines 215..229)**: if the loaded
   invoice's `estado` is already `EMITIDO`, the function short-circuits
   and returns the existing `{ invoice, customer, emissionPoint,
company }` tuple **without** calling `reserveSecuencial` or
   `buildClaveAcceso`. The secuencial therefore cannot be incremented
   by a duplicate request.

2. **Within the `emit` handler (lines 460..481)**: after
   `reserveInTransaction` returns, the handler checks the
   **pre-reservation** `existing.estado`. If it was already EMITIDO,
   the handler audits `invoice.emit.idempotent`, returns the current
   mirror via `buildEmitResponseBody(fresh, null)`, and **never calls
   `callSriCoreEmit`**. This is the assertion the integration test
   pins (`capture.length === 1` after two emits).

Together these guarantee:

- No second `SecuencialCounter` increment.
- No second sri-core `/v1/documents/emit` round-trip.
- The response body of the second call equals the first
  (`claveAcceso`, `secuencial`, `sriEstado`).

The `invoice.emit.idempotent` audit row provides forensic
distinction between the genuine emit and the idempotent replay.

## 8. Deviations from spec / plan

- **`Invoice` schema does not have `numeroAutorizacion` /
  `fechaAutorizacion` columns** — these mirror values live upstream
  on `SriDocument` (sri-core) and are sourced into the API response
  body directly from the freshly-returned `EmitDocumentResponse`
  rather than persisted on the Invoice row. `applyMirror` therefore
  intentionally `void`s those two patch fields (orchestrator.ts
  142..143). The refresh path re-pulls them from sri-core's
  `/v1/documents/:claveAcceso/status` and returns them inline. The
  spec's §6.3 sketch persists them onto the Invoice; the
  implementation persists `sriEstado` + `mensajesJson` and treats the
  others as ephemeral. This is documented as a follow-up below.

- **Network failure leaves the invoice EMITIDO (not BORRADOR)** —
  SPEC-0033 §4 FR-1.7 originally proposed `ERROR_RED → BORRADOR`. The
  implementation keeps `estado === EMITIDO` after a successful
  reservation even when sri-core is unreachable, marking only
  `sriEstado = ERROR_RED`. Rationale: the secuencial is irreversibly
  reserved (SPEC-0030), so reverting `estado` would leave the user
  with an empty `BORRADOR` that points to a burned secuencial — the
  next emit attempt on that same draft would consume yet another
  secuencial. Keeping `estado === EMITIDO` + `sriEstado === ERROR_RED`
  matches the SPEC-0033 §5 NFR-2 invariant ("sequential remains
  burned"), AC-2 ("sequential is not rolled back"), and the
  TASKS-0033 §1.1 line ("Subsequent refresh re-queries: if sri-core
  back, mirror updates"). The test
  `network failure: emit returns 502; invoice EMITIDO + sriEstado=ERROR_RED`
  pins this contract.

- **`reissue_not_allowed` accepts `ERROR_RED` in addition to
  `DEVUELTA`/`NO_AUTORIZADO`** — TASKS-0033 §2.1 mentions only the
  latter two. The implementation also allows reissue when the
  network failed and the secuencial was burned but no SRI document
  was created (orchestrator.ts 580..588). Without this, the user
  would have no path forward after a network-failure emit short of
  manual DB intervention. Documented here so the AC checklist accepts
  it.

- **Reissue does NOT mark the source invoice `ANULADO`** —
  SPEC-0033 §6.4 sketch sets `original.estado = "ANULADO"` after
  cloning. The implementation leaves the source row untouched
  (orchestrator.ts 595..720). Rationale: ANULAR is a separate SRI
  flow (anulación electrónica) that is explicitly out of scope per
  PROMPT-0033 §2 ("Do NOT implement anulación"). Marking the source
  ANULADO without issuing the corresponding SRI request would
  desynchronise the API's mirror from the SRI's reality. The
  follow-up "wire anulación once SRI flow lands" is tracked below.

## 9. Risks observed

| Risk                                                                                                     | Mitigation today                                                                                                                                                            | Future hardening                                                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Secuencial burned without successful SRI submission (network failure)                                    | `sriEstado = ERROR_RED`; reissue is allowed; audit row carries `reason: "sri.network"`                                                                                      | Async emit worker with retry budget (open follow-up)            |
| Long-running sri-core call inside the request lifecycle (P95 ≤ 5 s by NFR-1 — but blocks the connection) | 60 s `AbortSignal.timeout` on the fetch; service JWT TTL ≤ 60 s                                                                                                             | Queue-based async emit                                          |
| Cross-tenant probe on `:id/emit`                                                                         | `findInvoiceById` is `companyId`-scoped; returns 404 (test pinned)                                                                                                          | —                                                               |
| Duplicate emit due to client retry                                                                       | Idempotent at two layers (see §7); secuencial cannot be incremented twice                                                                                                   | —                                                               |
| Reissue race: two operators reissue the same DEVUELTA invoice                                            | `burnSecuencial` enforces a unique (`companyId`,`estab`,`ptoEmi`,`secuencial`) constraint; the second loser swallows `secuencial.already_burned` and continues idempotently | Add per-invoice advisory lock around the reissue transaction    |
| sri-core returns an unexpected payload shape                                                             | `EmitDocumentResponse` is the typed contract; non-JSON or non-2xx maps to UpstreamError → 502                                                                               | Zod-parse the response inside `sriCoreFetch` (currently `as T`) |
| JWT-secret leak                                                                                          | Secret comes from `env.SERVICE_JWT_SECRET` (Zod-validated ≥ 32 chars); never logged (REDACT_PATHS); never inlined                                                           | Rotate via env reload; consider per-tenant secret in v2         |

## 10. Security review

PROMPT-0033 §6 checklist — confirmed:

- ✅ `claveAcceso` is always server-computed. Two enforcement points:
  the `assertBodyHasNoClaveAcceso` guard rejects any inbound body
  carrying the field with a 400, and the create / update / orchestrator
  paths never read `claveAcceso` from `req.body`. Test:
  `body with claveAcceso is rejected (server-only field)` →
  asserts 400.
- ✅ JWT mint uses `env.SERVICE_JWT_SECRET` exclusively, never
  inlined. `env.ts:45..47` enforces ≥ 32 chars.
- ✅ Service JWT `exp ≤ now + 60s`: explicit in
  `callSriCoreEmit` (`serviceJwtTtlSeconds: 60`) and in
  `refresh`'s `sriCoreFetch` call (same value). Test asserts
  `exp - iat ≤ 60`.
- ✅ Audit rows include `companyId`, `actorUserId`, `entityId`,
  `claveAcceso` (treated as a non-sensitive public identifier — it
  appears on the printed RIDE / SRI portal),
  `outcome` (via the action suffix `.attempt|.success|.failure|.idempotent`),
  and `durationMs`. They never include the JWT or the request body.
- ✅ All sri-core fetches forward `X-Request-Id`
  (`sriCoreFetch` lines 100..102) for end-to-end log correlation.
- ✅ No `process.env.*` access outside `apps/api/src/env.ts` and the
  service-JWT helper (which itself takes the secret from `env.ts`).
- ✅ Cross-tenant probes return 404 (`findInvoiceById` is
  `companyId`-scoped; the orchestrator handlers all call it first).
  Tests: `cross-tenant emit on a foreign id returns 404` and
  `GET :id cross-tenant returns 404`.
- ✅ `companyId` is always taken from `req.companyId` (set by
  `requireTenant` from the session), never from the body. Test:
  `body that injects companyId is ignored; row binds to req.companyId`.
- ✅ Request-body fields not in the Zod schema are dropped by the
  contract layer; `claveAcceso` and `secuencial` are explicitly
  defended-in-depth at the handler boundary.
- ✅ The emit response body never includes the JWT or any internal
  secret; only public fields (`estado`, `claveAcceso`, `sriEstado`,
  `numeroAutorizacion`, `fechaAutorizacion`, `mensajes`, `invoice`).

## 11. Suggested follow-ups

1. **Persist `numeroAutorizacion` + `fechaAutorizacion` on the Invoice
   row** (or on a dedicated `InvoiceSriMirror` projection) so the
   detail GET does not need to join sri-core. Pair with a migration
   to add the columns. Spec'd in SPEC-0033 §6.3 sketch but not
   implemented — see §8.
2. **Async emit via worker queue** so the user request returns in
   ~50 ms with `EN_PROCESO`, while a background job runs the sri-core
   round-trip. The current synchronous P95 ≤ 5 s constraint
   (NFR-1) is tight against real SRI latency.
3. **UI cancel-button affordance while waiting** for the synchronous
   emit response; back-end already short-circuits on idempotent
   retries.
4. **Retry-with-backoff for transient sri-core 5xx at this layer** —
   today the orchestrator translates any non-2xx to a single
   `UpstreamError`. Sri-core itself does retries with jitter
   (SPEC-0025), but a thin per-call retry on top would absorb
   network blips before they surface as 502 to the operator.
5. **Anulación electrónica flow** — once SPEC-0050 (or equivalent)
   lands, wire the reissue handler to also issue the SRI anulación
   for the source invoice and only then mark its row
   `estado = "ANULADO"`. Today the source row is left untouched
   (see §8).
6. **Zod-parse the sri-core response inside `sriCoreFetch`** so a
   schema mismatch surfaces as a typed UpstreamError instead of a
   runtime cast.

## 12. Sign-off checklist

| AC                                                    | Statement                                                                                | Status                          | Evidence                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1                                                  | Emit transitions BORRADOR → EMITIDO atomically with secuencial reservation + claveAcceso | ✅                              | `happy path: BORRADOR → EMITIDO + AUTORIZADO; …` test; reserveInTransaction lines 232..268                                                                   |
| AC-2                                                  | SRI mirror fields updated post-emit per response                                         | ✅                              | `mirrorEmitResponse` field-by-field write (orchestrator.ts 344..358); happy-path + DEVUELTA + EN_PROCESO tests assert mirror state                           |
| AC-3                                                  | Idempotent: second emit is a no-op                                                       | ✅                              | `idempotent: second emit returns same body; secuencial unchanged; no second sri-core call`; `capture.length === 1` asserted                                  |
| AC-4                                                  | Reissue burns old secuencial and creates a new BORRADOR                                  | ✅                              | `DEVUELTA: invoice EMITIDO, sriEstado=DEVUELTA, mensajes populated; reissue creates new BORRADOR + burn row`; `BurnedSecuencial.reason = "reissue"` asserted |
| AC-5                                                  | Network failure leaves the invoice EMITIDO with ERROR_RED and returns 502                | ✅ (with deviation noted in §8) | `network failure: emit returns 502; invoice EMITIDO + sriEstado=ERROR_RED`; ProblemDetail code `sri.network` asserted                                        |
| AC-6                                                  | Refresh updates mirror from sri-core's status                                            | ✅                              | `re-queries sri-core; mirror updates` — invoice EN_PROCESO → AUTORIZADO after refresh                                                                        |
| AC-7                                                  | Payment mismatch rejects emit at 422                                                     | ✅                              | `payments_mismatch → 422; invoice stays BORRADOR; no sri-core call`; ProblemDetail code `payments_mismatch` asserted                                         |
| FV-1                                                  | `pnpm --filter @facturador/api test` exits 0                                             | ✅                              | 312/312 passed                                                                                                                                               |
| FV-2                                                  | `pnpm --filter @facturador/sri-core test` exits 0                                        | ✅                              | 397/397 passed                                                                                                                                               |
| FV-3                                                  | `pnpm -r typecheck` exits 0                                                              | ✅                              | 9/9 workspaces clean                                                                                                                                         |
| FV-4                                                  | `pnpm -r build` exits 0                                                                  | ✅                              | every workspace builds                                                                                                                                       |
| Security: JWT shape                                   | `aud=sri-core`, `iss=api`, `sub=companyId`, `exp ≤ iat+60`                               | ✅                              | test decodes captured Bearer token and asserts each claim                                                                                                    |
| Security: claveAcceso server-only                     | Body field rejected; mint site exists once in code                                       | ✅                              | guard in orchestrator + handlers; mint site is `orchestrator.ts:243` (single location)                                                                       |
| Security: companyId from session only                 | `req.companyId` is the sole source; body `companyId` ignored                             | ✅                              | `body that injects companyId is ignored` test                                                                                                                |
| Security: cross-tenant 404                            | No enumeration                                                                           | ✅                              | `GET :id cross-tenant returns 404` + `cross-tenant emit on a foreign id returns 404`                                                                         |
| Audit rows present                                    | attempt / success / failure / idempotent / reissue / refresh                             | ✅                              | grep of orchestrator + DB assertions in tests                                                                                                                |
| No leftover untracked TODO/FIXME in new invoice files | —                                                                                        | ✅                              | `grep -rn 'TODO\|FIXME' apps/api/src/invoices/ apps/api/test/invoices.test.ts` returns no hits                                                               |
