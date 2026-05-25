---
id: PLAN-0005
spec: SPEC-0005
title: Shared contracts (Zod) — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0005 — Shared contracts (Zod)

> Implementation plan for [SPEC-0005](../specs/0005-shared-contracts.md). Depends on PLAN-0001/0002/0004.

## 1. Goal

Establish `@facturador/contracts` as the single source of truth for cross-boundary types and validation. After this slice:

- Every Zod schema needed by SPECs 0010–0043 has a stable subpath export.
- Web, API, and SRI Core consume the same `RucSchema`, `ClaveAccesoSchema`, etc.
- Schemas are unit-tested at the package level (round-trip, error path).
- No `any` escape hatches; `z.infer` is the only type derivation path consumed downstream.

## 2. Inputs

- [SPEC-0005](../specs/0005-shared-contracts.md) — authoritative.
- [ai/context/glossary.md](../context/glossary.md) — domain vocabulary verbatim.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — clave de acceso algorithm, RUC/cédula formats.
- [SPEC-0022](../specs/0022-clave-acceso-generator.md) — clave de acceso checksum; used in refine.

## 3. Architecture decisions

| Decision                                                                                                                           | Rationale                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| One package, multiple subpath exports (`@facturador/contracts/primitives`, `/auth`, `/invoices`, `/customers`, `/sri`, `/errors`). | Treeshakable; consumers import only what they need.                        |
| Schemas live under `src/<domain>/<name>.ts`; each file exports the schema and its inferred type.                                   | Predictable file naming, easy review.                                      |
| Zod 3.x with `.brand<"Ruc">()` etc. on primitives.                                                                                 | Prevents accidental cross-assignment of plain strings to validated values. |
| **No I/O** in this package (no fetch, no fs). Pure validation only.                                                                | Lets it be consumed from web bundles without polyfills.                    |
| Re-export `z` for downstream consistency.                                                                                          | Avoids version drift between packages.                                     |
| Refines for `RucSchema` (módulo 11), `CedulaSchema` (módulo 10), `ClaveAccesoSchema` (49 digits + módulo 11).                      | Catches malformed values at the boundary, not deep in business code.       |
| Discriminated unions for events / payloads (`SriEventSchema`, `ProblemDetail.errors`).                                             | Type narrowing at consumers.                                               |
| `exports` map in `package.json` is the contract — adding a new subpath is an intentional, reviewable change.                       | Prevents accidental coupling on internals.                                 |

## 4. Phases

### Phase 1 — Primitives

Create `src/primitives/`:

- `ulid.ts` — `UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).brand<"Ulid">()`.
- `email.ts` — `EmailSchema = z.string().email().transform(v => v.toLowerCase()).brand<"Email">()`.
- `ruc.ts` — 13 digits + módulo 11 refine (rules per `docs/sri/...`).
- `cedula.ts` — 10 digits + módulo 10 refine.
- `pasaporte.ts` — 1–20 alphanumeric (Spec details).
- `clave-acceso.ts` — 49 digits + módulo 11 refine (delegate compute to SPEC-0022 algorithm; in contracts we re-implement the pure check or import a shared helper from `@facturador/utils`).
- `money.ts` — non-negative `z.number().multipleOf(0.01)` with safe parsing (no float drift on submit; backend uses Decimal.js separately).
- `iso-date.ts` — `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` for `fechaEmision` (Ecuador local TZ).
- `currency-code.ts` — enum `["DOLAR"]` for v1.
- `ambiente.ts` — `z.enum(["1","2"])` (1=pruebas, 2=producción) per SRI.
- `tipo-emision.ts` — `z.enum(["1"])` (normal; offline=1 in 2025 scheme).
- `tipo-identificacion.ts` — `z.enum(["04","05","06","07","08"])`.

### Phase 2 — Domain schemas

Create `src/`:

- `auth/`
  - `login.ts` — `LoginRequestSchema`, `LoginResponseSchema`, `MeResponseSchema`.
  - `session.ts` — `SessionTenantSwitchSchema`.
- `tenants/`
  - `tenant.ts` — `TenantSchema`, `CreateTenantSchema`.
  - `membership.ts` — `MembershipSchema`, `RoleSchema = z.enum(["OWNER","ADMIN","ACCOUNTANT","OPERATOR","VIEWER"])`.
- `customers/`
  - `customer.ts` — discriminated union by `tipoIdentificacion` (04 RUC / 05 cédula / 06 pasaporte / 07 consumidor final / 08 exterior), with field requirements per spec 0031.
  - `create-customer.ts`, `update-customer.ts`.
- `invoices/`
  - `invoice.ts` — invoice header + lines + payments + adicionales (shapes only; business calc in api package).
  - `create-invoice.ts`, `update-invoice.ts`, `preview-totals.ts`, `emit-response.ts`.
  - `list.ts` — `InvoiceListItemSchema`, `InvoiceListResponseSchema`.
  - `detail.ts` — `InvoiceDetailSchema` aggregating header + lines + payments + adicionales + sri.
- `sri/`
  - `document.ts` — `SriDocumentSchema`, `SriEstadoSchema`.
  - `event.ts` — `SriEventSchema` (discriminated by `etapa`).
  - `emit-request.ts`, `emit-response.ts`, `status-response.ts` (service-to-service shapes).
  - `mensaje.ts` — `SriMensajeSchema` (identificador, mensaje, tipo, informacionAdicional?).
- `errors/`
  - `problem-detail.ts` — RFC 7807-ish: `{ type: string, title: string, status: number, code: string, detail?: string, instance?: string, errors?: SriMensajeSchema[] }`.

### Phase 3 — Index / exports

- `src/index.ts` is intentionally **empty** (or only `export {}`). Consumers always import via subpath, never the root.
- `package.json#exports`:
  ```json
  {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./primitives": {
      "types": "./dist/primitives/index.d.ts",
      "import": "./dist/primitives/index.js"
    },
    "./auth": "./dist/auth/index.js",
    "./tenants": "...",
    "./customers": "...",
    "./invoices": "...",
    "./sri": "...",
    "./errors": "..."
  }
  ```
  Each domain folder has its own `index.ts` that re-exports.

### Phase 4 — Unit tests

For each schema: at least one happy-path and one error-path test. For `RucSchema`, `CedulaSchema`, `ClaveAccesoSchema`: include checksum-mismatch fixtures.

### Phase 5 — Downstream wiring

- `apps/api` adds dep `@facturador/contracts`.
- `apps/sri-core` adds dep `@facturador/contracts`.
- `apps/web` adds dep `@facturador/contracts`.
- A trivial smoke test imports `RucSchema` from each and validates a fixture.

## 5. Risks & mitigations

| Risk                                        | Mitigation                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Schema drift between contracts and Prisma.  | Tests pin field names; CI runs a schema-vs-prisma name diff (manual now; automated later).                                    |
| Bundle bloat in web due to Zod size.        | Zod is small; tree-shaking via subpath exports keeps imports minimal.                                                         |
| `.brand` types leak as opaque to consumers. | Document a `toString()` helper if needed; for v1 the branded string suffices.                                                 |
| Float rounding on money.                    | `MoneySchema.multipleOf(0.01)` only; downstream uses Decimal.js for computation; this package never computes, only validates. |

## 6. Validation strategy

- `pnpm --filter @facturador/contracts test` exits 0.
- Coverage on this package ≥ 95% (lots of pure functions; cheap to test exhaustively).
- A consumer-side smoke test (`apps/api`) imports `LoginRequestSchema` and validates a known good + known bad fixture.
- TypeScript `tsc --noEmit` passes for every workspace member after wiring.

## 7. Exit criteria

- All SPEC-0005 acceptance criteria pass.
- Every consumer can import the schemas they need without reaching into internals.
- A new schema added in any later spec (0010+) does not require restructuring this package — only adding a file and a subpath export.

## 8. Out of scope

- Server-side validation middleware → SPEC-0006 (the validator helper).
- Form-level helpers (zodResolver, etc.) → SPEC-0040.
- Decimal arithmetic / totals computation → SPEC-0032.
