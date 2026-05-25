---
id: TASKS-0005
spec: SPEC-0005
plan: PLAN-0005
title: Shared contracts (Zod) — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0005 — Shared contracts (Zod)

> Granular checklist for [SPEC-0005](../specs/0005-shared-contracts.md) + [PLAN-0005](../plans/0005-shared-contracts-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ No `z.any()` or `z.unknown()` escape hatches in domain schemas.
- ❌ No I/O imports (`fs`, `node:fs`, `fetch`, network) in this package.
- ❌ Field names must use Spanish SRI vocabulary verbatim (`claveAcceso`, `razonSocial`, `ambiente`, `tipoEmision`, `tipoIdentificacion`, `fechaEmision`, etc.). Refer to `ai/context/glossary.md`.
- ❌ Schemas must not duplicate Prisma model shapes — they are the API/contract surface, not the DB.
- ✅ Every schema has at least one happy-path and one error-path test.
- ✅ Each subpath export must be reachable from a consumer via the documented path.

## 1. Package scaffolding

- [ ] **1.1** Add Zod 3.x as a dep of `packages/contracts/package.json`.
      **Validate**: `pnpm --filter @facturador/contracts add zod@^3` succeeds; `node -e "console.log(require('zod').z)"` works from the package after install.

- [ ] **1.2** Set up `packages/contracts/tsconfig.json` with `declaration: true`, `composite: true`, `outDir: dist`, `rootDir: src`.
      **Validate**: `pnpm --filter @facturador/contracts typecheck` exits 0.

- [ ] **1.3** Add to `packages/contracts/package.json` `exports` map: one entry per domain (`./primitives`, `./auth`, `./tenants`, `./customers`, `./invoices`, `./sri`, `./errors`). Root `.` resolves to an empty `dist/index.js` or omits direct usage; downstream consumers go through subpaths.
      **Validate**: a smoke script `node -e "import('@facturador/contracts/primitives').then(m=>console.log(Object.keys(m)))"` (from `apps/api` after wiring) prints keys.

## 2. Primitives

For each schema below, create `packages/contracts/src/primitives/<name>.ts`, plus an entry in `packages/contracts/src/primitives/index.ts`. Each must have a sibling `<name>.test.ts`.

- [ ] **2.1** `ulid.ts`: `UlidSchema` regex `^[0-9A-HJKMNP-TV-Z]{26}$`, branded `"Ulid"`.
      **Validate**: test parses `01HX8K0PYFA9B7Y1M2N3P4Q5R6`, rejects `"abc"`.

- [ ] **2.2** `email.ts`: `EmailSchema` validates email, transforms to lowercase, branded `"Email"`.
      **Validate**: test asserts `"USER@x.com"` → `"user@x.com"`; rejects `"not-email"`.

- [ ] **2.3** `ruc.ts`: 13 digits + módulo 11 refine per SRI rules.
      **Validate**: test accepts a known valid RUC (synthetic, e.g., `1790012345001`); rejects `"1234567890001"` (bad checksum) and `"123"` (wrong length).

- [ ] **2.4** `cedula.ts`: 10 digits + módulo 10 refine.
      **Validate**: tests accept a known valid synthetic cédula; reject bad checksum and bad length.

- [ ] **2.5** `pasaporte.ts`: regex `^[A-Za-z0-9]{1,20}$`, branded.
      **Validate**: accepts `"AB123XYZ"`; rejects `""`, rejects 21 chars.

- [ ] **2.6** `clave-acceso.ts`: 49 digits + módulo 11 refine (algorithm per `docs/sri-facturacion-electronica-ecuador.md`).
      **Validate**: a known valid 49-digit fixture passes; same string with last digit modified fails.

- [ ] **2.7** `money.ts`: `MoneySchema = z.number().multipleOf(0.01).nonnegative()`.
      **Validate**: accepts `0.01`, `1234.56`; rejects `-1`, `0.001`.

- [ ] **2.8** `iso-date.ts`: regex `^\d{4}-\d{2}-\d{2}$`.
      **Validate**: accepts `"2026-05-19"`; rejects `"19/05/2026"`.

- [ ] **2.9** `currency-code.ts`: `z.enum(["DOLAR"])`.
      **Validate**: accepts `"DOLAR"`; rejects `"USD"`.

- [ ] **2.10** `ambiente.ts`: `z.enum(["1","2"])`.
      **Validate**: accepts `"1"`, `"2"`; rejects `"3"`, `1`.

- [ ] **2.11** `tipo-emision.ts`: `z.enum(["1"])`.
      **Validate**: accepts `"1"`; rejects `"2"`.

- [ ] **2.12** `tipo-identificacion.ts`: `z.enum(["04","05","06","07","08"])`.
      **Validate**: each value accepted; `"01"` rejected.

## 3. Auth schemas

- [ ] **3.1** `auth/login.ts`:

  - `LoginRequestSchema = z.object({ email: EmailSchema, password: z.string().min(8).max(72) })`.
  - `LoginResponseSchema = z.object({ userId: UlidSchema, displayName: z.string(), tenants: z.array(MembershipSummarySchema) })`.
  - `MeResponseSchema = z.object({ user: ..., currentCompanyId: UlidSchema.nullable(), tenants: ... })`.
    **Validate**: tests assert known good + known bad payloads.

- [ ] **3.2** `auth/session.ts`: `SessionTenantSwitchSchema = z.object({ companyId: UlidSchema })`.
      **Validate**: tests.

## 4. Tenants schemas

- [ ] **4.1** `tenants/tenant.ts`: `TenantSchema` (all Company fields exposed in API), `CreateTenantSchema` (subset).
      **Validate**: tests.

- [ ] **4.2** `tenants/membership.ts`: `RoleSchema`, `MembershipSchema`.
      **Validate**: tests.

## 5. Customers schema

- [ ] **5.1** `customers/customer.ts`: Discriminated union by `tipoIdentificacion`. Each branch requires the corresponding identification field (RUC/cedula/pasaporte/none for consumidor final/exterior). Fields per [SPEC-0031](../specs/0031-customer-catalog.md).
      **Validate**: tests cover each branch (5 happy paths) and at least 3 error paths (wrong branch fields, missing required, bad checksum).

- [ ] **5.2** `customers/create-customer.ts`, `update-customer.ts`: derive from the union.
      **Validate**: tests.

## 6. Invoices schemas

- [ ] **6.1** `invoices/invoice.ts`: header + lines + payments + adicionales (shapes only; arithmetic lives in api).
      **Validate**: tests on at least: empty lines rejected, line with negative price rejected.

- [ ] **6.2** `invoices/create-invoice.ts`, `update-invoice.ts`, `preview-totals.ts`, `emit-response.ts`.
      **Validate**: tests.

- [ ] **6.3** `invoices/list.ts`: `InvoiceListItemSchema`, `InvoiceListResponseSchema` per SPEC-0043 §6.2.
      **Validate**: tests.

- [ ] **6.4** `invoices/detail.ts`: aggregate schema per SPEC-0043 §6.2.
      **Validate**: tests.

## 7. SRI schemas

- [ ] **7.1** `sri/document.ts`: `SriEstadoSchema = z.enum(["PENDIENTE","FIRMADO","ENVIADO","RECIBIDA","EN_PROCESO","AUTORIZADO","NO_AUTORIZADO","DEVUELTA","ERROR_RED","ERROR_BUILD"])`. `SriDocumentSchema` per SPEC-0020.
      **Validate**: tests.

- [ ] **7.2** `sri/event.ts`: `SriEventSchema` discriminated by `etapa: z.enum(["BUILD","SIGN","SEND","RECEIVE","AUTHORIZE","POLL","ERROR"])`. Fields: `id`, `documentId`, `etapa`, `estado`, `mensajes`, `durationMs`, `createdAt`.
      **Validate**: tests.

- [ ] **7.3** `sri/emit-request.ts` and `emit-response.ts`: service-to-service shapes per SPEC-0020/0033.
      **Validate**: tests.

- [ ] **7.4** `sri/mensaje.ts`: `SriMensajeSchema = z.object({ identificador: z.string(), mensaje: z.string(), tipo: z.enum(["ERROR","ADVERTENCIA","INFORMATIVO"]), informacionAdicional: z.string().optional() })`.
      **Validate**: tests.

## 8. Error schema

- [ ] **8.1** `errors/problem-detail.ts`: `ProblemDetailSchema = z.object({ type: z.string().url().optional(), title: z.string(), status: z.number().int().gte(100).lt(600), code: z.string(), detail: z.string().optional(), instance: z.string().optional(), errors: z.array(SriMensajeSchema).optional() })`.
      **Validate**: tests.

## 9. Domain index files

- [ ] **9.1** Each domain has an `index.ts` re-exporting its schemas and inferred types.
      **Validate**: `node -e "import('@facturador/contracts/invoices').then(m=>console.log(Object.keys(m).filter(k=>k.endsWith('Schema')).length))"` returns ≥ 5.

## 10. Consumer wiring

- [ ] **10.1** Add `@facturador/contracts` as dep in `apps/api`, `apps/sri-core`, `apps/web`.
      **Validate**: `pnpm install` succeeds; symlinks present.

- [ ] **10.2** In `apps/api`, add a smoke test `src/contracts.smoke.test.ts` that imports `RucSchema` and `LoginRequestSchema`, validates one good + one bad payload for each.
      **Validate**: `pnpm --filter @facturador/api test` exits 0.

## 11. Coverage gate

- [ ] **11.1** Run `pnpm --filter @facturador/contracts test --coverage`.
      **Validate**: statement coverage ≥ 95%; if below, add more cases (not exclusions).

## 12. Acceptance criteria

- [ ] AC-1: Every Zod schema needed by downstream specs (0010–0043) has a subpath export.
- [ ] AC-2: Branded primitives prevent assignment of unvalidated strings to validated parameters at the type level.
- [ ] AC-3: Checksum refines (RUC, cédula, claveAcceso) reject bad-checksum strings.
- [ ] AC-4: Discriminated `CustomerSchema` enforces per-branch field rules.
- [ ] AC-5: Consumer apps successfully import schemas through documented subpaths.
- [ ] AC-6: Coverage ≥ 95% on this package.
- [ ] AC-7: No `any` / `unknown` escapes.

## 13. Definition of Done

- All tasks ticked, coverage gate met, consumer smoke tests green.
- Review file `ai/reviews/0005-shared-contracts-review.md` written.
