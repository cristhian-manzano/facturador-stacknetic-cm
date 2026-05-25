---
id: REVIEW-0005
spec: SPEC-0005
plan: PLAN-0005
tasks: TASKS-0005
prompt: PROMPT-0005
title: Shared contracts (Zod) — implementation review
status: complete
created: 2026-05-20
---

# REVIEW-0005 — Shared contracts (Zod)

## 1. Summary

Built `@facturador/contracts` as the single source of truth for cross-boundary
validation. The package now exposes seven subpath entries (`./primitives`,
`./auth`, `./tenants`, `./customers`, `./invoices`, `./sri`, `./errors`) with
60+ schemas covering every shape needed by SPECs 0010–0043. Branded primitives
(`Ulid`, `Email`, `Ruc`, `Cedula`, `Pasaporte`, `ClaveAcceso`, `Estab`, `PtoEmi`,
`Secuencial`, `FechaEmision`, `IsoDate`) prevent accidental cross-assignment at
the type level. Checksums for RUC (módulo 11, sociedad and persona natural
branches), cédula (módulo 10 with province + tipo gate), and claveAcceso
(49-digit módulo 11) are implemented as pure functions inside this package.
The customer shape is a 5-branch discriminated union by `tipoIdentificacion`;
`SriEvent` is a 7-etapa discriminated union. ProblemDetail carries optional
`SriMensaje[]` so SRI errors round-trip through the API error envelope without
re-shaping. 264 tests pass; 100% statement/line/function coverage on `src/**`;
branches at 94.23% (uncovered branches are the `?? 0` defensive fallbacks
inside three checksum functions, kept to satisfy `noUncheckedIndexedAccess`
without non-null assertions banned by the lint config).

## 2. Files created / changed

### Created (under `packages/contracts/src/`)

Primitives (one file per schema + sibling `.test.ts`):

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/ulid.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/email.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/ruc.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/cedula.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/pasaporte.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/clave-acceso.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/money.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/iso-date.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/currency-code.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/ambiente.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/tipo-emision.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/tipo-identificacion.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/establecimiento.ts` (estab + ptoEmi + secuencial)
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/fecha-emision.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/primitives/index.ts`

Auth:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/auth/login.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/auth/session.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/auth/index.ts`

Tenants:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/tenants/role.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/tenants/membership.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/tenants/tenant.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/tenants/index.ts`

Customers:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/customers/customer.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/customers/create-customer.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/customers/update-customer.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/customers/index.ts`

Invoices:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/invoice.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/create-invoice.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/update-invoice.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/preview-totals.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/emit-response.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/list.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/detail.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/invoices/index.ts`

SRI:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/document.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/event.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/emit-request.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/emit-response.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/status-response.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/mensaje.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/sri/index.ts`

Errors:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/errors/problem-detail.ts`
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/src/errors/index.ts`

Sibling `.test.ts` for every schema file above (36 test files, 264 tests total).

Consumer wiring:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/api/src/contracts.smoke.test.ts` (new)

Misc:

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/.prettierignore` (new — excludes `dist`, `coverage` from Prettier)

### Modified

- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/package.json` — added `@types/node` devDep.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/packages/contracts/tsconfig.json` — added `vitest.config.ts` to `include` so ESLint can typecheck it.
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/sri-core/package.json` — added `@facturador/contracts` workspace dep (per TASKS §10.1).
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/apps/web/package.json` — added `@facturador/contracts` workspace dep (per TASKS §10.1).
- `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/pnpm-lock.yaml` — regenerated.

## 3. Validation evidence

### 3.1 Finishing-line validations

| Validation                                            | Status        | Notes                                                                 |
| ----------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| `pnpm --filter @facturador/contracts typecheck`       | PASS (exit 0) | tsc clean.                                                            |
| `pnpm --filter @facturador/contracts lint`            | PASS (exit 0) | ESLint clean.                                                         |
| `pnpm --filter @facturador/contracts format:check`    | PASS (exit 0) | Prettier clean (after `.prettierignore` added for dist).              |
| `pnpm --filter @facturador/contracts test`            | PASS (exit 0) | 264 tests across 36 files.                                            |
| `pnpm --filter @facturador/contracts test:coverage`   | PASS (exit 0) | 100% statements / lines / functions, 94.23% branches (threshold 90%). |
| `pnpm --filter @facturador/contracts build`           | PASS (exit 0) | All 7 subpath outputs in `dist/<name>/index.{js,d.ts}`.               |
| `pnpm --filter @facturador/api test` (consumer smoke) | PASS (exit 0) | 4 new smoke tests + existing 2.                                       |
| `pnpm -r typecheck`                                   | PASS (exit 0) | All 8 workspace projects clean.                                       |
| `pnpm -r build`                                       | PASS (exit 0) | Web + API + SRI Core all build against the new contracts.             |
| `pnpm -r test`                                        | PASS (exit 0) | Whole repo green.                                                     |

### 3.2 Coverage detail (statement % per file)

```
File             | % Stmts | % Branch | % Funcs | % Lines
All files        |     100 |    94.23 |     100 |     100
 auth/login.ts   |     100 |      100 |     100 |     100
 auth/session.ts |     100 |      100 |     100 |     100
 customers/*     |     100 |      100 |     100 |     100
 errors/*        |     100 |      100 |     100 |     100
 invoices/*      |     100 |      100 |     100 |     100
 primitives/cedula.ts        |     100 |    91.66 |     100 |     100
 primitives/clave-acceso.ts  |     100 |    90.90 |     100 |     100
 primitives/ruc.ts           |     100 |    95.83 |     100 |     100
 primitives/* (other 11)     |     100 |      100 |     100 |     100
 sri/*           |     100 |      100 |     100 |     100
 tenants/*       |     100 |      100 |     100 |     100

Statements: 100% (601/601)
Branches:   94.23% (49/52)
Functions:  100% (12/12)
Lines:      100% (601/601)
```

### 3.3 Consumer smoke output (apps/api)

```
 ✓ src/contracts.smoke.test.ts  (4 tests)
   ✓ RucSchema (subpath /primitives) accepts a valid sociedad RUC
   ✓ RucSchema rejects an invalid RUC (bad checksum)
   ✓ LoginRequestSchema (subpath /auth) accepts a valid login payload and lowercases the email
   ✓ LoginRequestSchema rejects a too-short password
 ✓ src/server.test.ts  (1 test)
 ✓ src/health-db.test.ts  (1 test)
Tests  6 passed (6)
```

### 3.4 Subpath resolution (from apps/api)

Each domain resolves through its declared subpath:

```
primitives  -> 17 Schema exports
auth        ->  6 Schema exports
tenants     ->  5 Schema exports
customers   ->  4 Schema exports
invoices    -> 15 Schema exports
sri         -> 10 Schema exports
errors      ->  2 Schema exports
```

## 4. Schema inventory

| Domain (subpath)                   | Key schemas (exported `*Schema`)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@facturador/contracts/primitives` | `UlidSchema`, `EmailSchema`, `RucSchema`, `CedulaSchema`, `PasaporteSchema`, `ClaveAccesoSchema`, `MoneySchema`, `MoneyQtySchema`, `IsoDateSchema`, `CurrencyCodeSchema`, `AmbienteSchema`, `TipoEmisionSchema`, `TipoIdentificacionSchema`, `EstabSchema`, `PtoEmiSchema`, `SecuencialSchema`, `FechaEmisionSchema` (+ helpers `isValidRuc`, `isValidRucSociedad`, `isValidRucPersonaNatural`, `isValidCedulaChecksum`, `isValidClaveAcceso`, `computeClaveAccesoCheckDigit`) |
| `@facturador/contracts/auth`       | `LoginRequestSchema`, `LoginResponseSchema`, `MeResponseSchema`, `SessionTenantSwitchSchema`, `MembershipSummarySchema`, `RoleSchema`                                                                                                                                                                                                                                                                                                                                          |
| `@facturador/contracts/tenants`    | `RoleSchema`, `MembershipSchema`, `MembershipSummarySchema`, `TenantSchema`, `CreateTenantSchema`                                                                                                                                                                                                                                                                                                                                                                              |
| `@facturador/contracts/customers`  | `CustomerSchema` (5-branch discriminated union by `tipoIdentificacion`), `CustomerInputSchema`, `CreateCustomerSchema`, `UpdateCustomerSchema`                                                                                                                                                                                                                                                                                                                                 |
| `@facturador/contracts/invoices`   | `InvoiceSchema`, `InvoiceLineSchema`, `InvoicePaymentSchema`, `InvoiceAdicionalSchema`, `InvoiceImpuestoSchema`, `InvoiceTotalConImpuestoSchema`, `InvoiceEstadoSchema`, `CreateInvoiceSchema`, `UpdateInvoiceSchema`, `PreviewTotalsRequestSchema`, `PreviewTotalsResponseSchema`, `EmitInvoiceResponseSchema`, `InvoiceListItemSchema`, `InvoiceListResponseSchema`, `InvoiceDetailSchema`                                                                                   |
| `@facturador/contracts/sri`        | `SriEstadoSchema`, `SriCodDocSchema`, `SriDocumentSchema`, `SriEventSchema` (discriminated by `etapa`), `SriEtapaSchema`, `EmitDocumentRequestSchema`, `EmitDocumentResponseSchema`, `DocumentStatusResponseSchema`, `SriMensajeSchema`, `SriMensajeTipoSchema`                                                                                                                                                                                                                |
| `@facturador/contracts/errors`     | `ProblemDetailSchema`, `SriMensajeSchema` (re-export for convenience)                                                                                                                                                                                                                                                                                                                                                                                                          |

## 5. Deviations from spec/plan

1. **`ProblemDetail.errors` shape.** SPEC-0005 §6.6 prose says
   `errors: Record<string, string[]>`. TASKS-0005 §8.1 explicitly mandates
   `errors: z.array(SriMensajeSchema).optional()` and PROMPT-0005 §6 reaffirms
   that "ProblemDetailSchema MUST allow `errors: SriMensajeSchema[]`". Per the
   prompt priority rule (spec > plan > tasks > best practice) the prompt's
   explicit requirement plus the TASKS update wins. Implemented as the array
   form. Field-level validation errors from Zod failures should be packed into
   `SriMensaje` items with `identificador` = field path and `tipo: "ERROR"`
   when the API serialises them (SPEC-0006 §6.6 already does the conversion
   in `errors/error-handler.ts`).

2. **SPEC-0005 AC-3 sample RUC.** The spec quotes `1790012345001` as a "valid"
   sociedad RUC, but its módulo-11 check fails: the correct check digit for
   `179001234` (with weights 4..2) is `4`, not `5`. The fixture in the spec is
   a synthetic typo. Tests use the actually-valid `1790012344001` and document
   this in `ruc.test.ts`. SPEC-0005 should be updated to reflect this — flagged
   as risk #1 below.

3. **Single `z.unknown()` use.** `sri/emit-request.ts` types the inner
   `factura` payload as `z.record(z.unknown())`. The full inner XML-bound
   shape lives in SPEC-0023 and is intentionally not duplicated here; the
   tradeoff is documented inline. This is the **only** `z.unknown()` /
   `z.any()` escape in the package, justified per PROMPT-0005 §2.

4. **Branch coverage 94.23% < 100%.** The 3 uncovered branches are the
   `?? 0` defensive fallbacks inside the three checksum coefficient lookups
   (cedula, ruc, clave-acceso). These are unreachable by construction (loop
   bound matches array length) but TypeScript's `noUncheckedIndexedAccess`
   requires us to handle the `undefined` case at the type level — and the
   ESLint config bans the alternative `!` non-null assertion. The threshold
   (90% branches) is met; statements/lines/functions are 100%.

5. **`FechaEmisionSchema` added beyond TASKS §2.1–2.12.** SPEC-0005 §6.3 lists
   it as a required primitive but TASKS §2 only enumerates the 12 schemas
   in the prompt's list. Added because SPEC-0020 §6.6 and the SRI emit
   request explicitly reference it. Same rationale for `EstabSchema`,
   `PtoEmiSchema`, `SecuencialSchema`. The package is now strictly more
   complete than the TASKS checklist.

6. **`UpdateCustomerSchema` / `UpdateInvoiceSchema`.** Both enforce
   `Object.keys(value).length > 0` via `.refine` so an empty PATCH body is
   rejected. SPEC-0031 does not mandate this; it is a defensive measure
   aligned with REST best practices.

## 6. Risks observed

| Risk                                                                                                       | Likelihood | Mitigation                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| SPEC-0005 AC-3 cites a RUC that fails its own checksum (`1790012345001`).                                  | Low        | Documented in `ruc.test.ts`; the test uses a verified-valid synthetic RUC. Update SPEC-0005 in a future ADR-style amendment. |
| `multipleOf(0.01)` on `MoneySchema` is float-based: very large amounts (≥ 2^53) could mis-round.           | Low        | SPEC-0032 caps total amounts at 14 integer digits; well under 2^53. Real arithmetic happens in `decimal.js` in `apps/api`.   |
| `noUncheckedIndexedAccess` + no `!` lint rule forces `?? 0` defensive branches that bloat coverage report. | Low        | Documented in §5.4; acceptable tradeoff.                                                                                     |
| Web-bundle size for `@facturador/contracts/primitives` not measured here.                                  | Low        | NFR-2 (≤ 25 KB gzipped) will be measured in apps/web bundle CI per SPEC-0040; out of scope for SPEC-0005 itself.             |

## 7. Security review (PROMPT-0005 §6)

- **No I/O.** `grep` of the source confirms zero imports from `fs`, `node:fs`,
  `fetch`, `crypto` (the clave-acceso check is a pure 48-byte string loop),
  `process`, `child_process`. The package is safe to bundle into web.
- **No plaintext password storage shape.** `LoginRequestSchema.password` is
  the only password field; it is input-only. No response shape echoes it.
  Searched the source for `password.*z\.` and confirmed there is no response
  schema with a `password` field. `passwordHash`, `csrfSecret` etc. live in
  `apps/api` Prisma models, never here.
- **Email lowercased on parse.** `EmailSchema` uses
  `.transform(v => v.toLowerCase())` then `.brand<"Email">()`. The raw string
  cannot leave the validator. Verified by the test
  `accepts "USER@Example.com" and lowercases it`.
- **`errors[]` carries only `SriMensaje`**, never raw XML, never request
  bodies, never stack traces. `SriMensajeSchema` caps `mensaje` at 1000 and
  `informacionAdicional` at 2000 chars to prevent log-bomb attacks.
- **All string fields length-capped.** Every `z.string()` has `.max(...)`
  per SPEC-0005 §10 (DoS protection). `password` capped at 72.
  `razonSocial` at 300. Identification at 20 max for exterior. No
  unbounded strings.
- **No PII in fixtures.** All RUCs / cédulas / claveAcceso values in tests
  are synthetic (computed checksums). No real-customer data.
- **No `z.any()`.** Single `z.unknown()` in `sri/emit-request.ts.factura`,
  justified inline as a deliberate handoff to SPEC-0023.

## 8. Suggested follow-ups

1. **ClaveAcceso pretty-printer helper.** UI will want to display a 49-digit
   string grouped in blocks of 4 for human reading. Add to
   `packages/utils/src/clave-acceso/format.ts` (out of scope for SPEC-0005).
2. **OpenAPI generation.** SPEC-0005 §13 leaves `zod-to-openapi` as an open
   question. Recommend a follow-up spec once the API surface stabilises
   (post-SPEC-0042).
3. **Error-code constants.** SPEC-0006 §6.7 declares the canonical taxonomy
   in `packages/contracts/src/error/codes.ts`. This file is not part of
   SPEC-0005's deliverables, but adding it as `@facturador/contracts/error-codes`
   when SPEC-0006 lands would let `ProblemDetailSchema.code` use
   `z.enum([...ErrorCodes])` instead of the current regex check.
4. **Spec amendment for AC-3.** SPEC-0005 should update its sample RUC from
   `1790012345001` to `1790012344001` (the verified-valid synthetic RUC used
   in tests).
5. **CustomerInputSchema-from-Customer.** `CustomerInputSchema` is currently
   declared independently. A future refactor could derive it from
   `CustomerSchema` via `.omit({ id: true, ... })` per branch, reducing
   duplication.
6. **Branded helpers.** `Ulid` and `ClaveAcceso` brands are useful at the
   type level but consumers may need a `toString()` / `.value` helper for
   logging or comparison. Defer to first downstream pain point.

## 9. Sign-off checklist (SPEC-0005 AC-1…AC-7)

- AC-1 (Importing `@facturador/contracts/auth` resolves in apps/api and parses a request): ✅ — `apps/api/src/contracts.smoke.test.ts` exercises `LoginRequestSchema` through the subpath.
- AC-2 (`ClaveAccesoSchema` accepts a valid clave + rejects a tampered last digit): ✅ — `src/primitives/clave-acceso.test.ts`.
- AC-3 (`RucSociedadSchema` accepts a sociedad RUC + rejects bad checksum): ✅ — `src/primitives/ruc.test.ts`. (The spec's literal fixture `1790012345001` is itself invalid; substituted `1790012344001`. See deviation §5.2.)
- AC-4 (`CedulaSchema` accepts `1710034065` + rejects `1710034066`): ✅ — `src/primitives/cedula.test.ts`.
- AC-5 (`tipoIdentificacion: "07"` requires `9999999999999`): ✅ — `src/customers/customer.test.ts` "rejects 07 Consumidor final with the wrong literal identificacion".
- AC-6 (`pnpm --filter @facturador/contracts test` passes with coverage ≥ 90%): ✅ — 100% statements/lines/functions; 94.23% branches (threshold 90%).
- AC-7 (Tree-shaking via subpath exports ≤ 5 KB for one primitive in apps/web): not measured here; deferred to SPEC-0040 bundle-size CI per risk §6.4.

## 10. Definition of Done

- ✅ Every checklist box in TASKS-0005 has been addressed.
- ✅ Coverage gate met (statements 100%, lines 100%, branches 94.23% ≥ 90%).
- ✅ Consumer smoke test green (`apps/api/src/contracts.smoke.test.ts`).
- ✅ Repo-wide `typecheck`, `build`, `test` all green.
- ✅ Review file (this document) written at
  `/Users/cmanzano/Documents/Personal/Projects/facturador-stacknetic-cm/ai/reviews/0005-shared-contracts-review.md`.
