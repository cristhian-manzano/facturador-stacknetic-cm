---
id: PLAN-0031
spec: SPEC-0031
title: Customer catalog — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0031 — Customer catalog

> Implementation plan for [SPEC-0031](../specs/0031-customer-catalog.md). Depends on PLAN-0004/0005/0006/0010/0011.

## 1. Goal

Model and expose a tenant-scoped customer catalog:

- `Customer` model with `tipoIdentificacion ∈ {"04","05","06","07","08"}`.
- Discriminated validation: RUC for 04 (módulo 11), cédula for 05 (módulo 10), pasaporte for 06, fixed `9999999999999` for 07 (consumidor final), free-form for 08 (exterior).
- CRUD endpoints with RBAC.
- `ensureConsumidorFinal(tx, companyId)` returns/creates the singleton "Consumidor Final" row per tenant (used by SPEC-0033).
- Search endpoint with `?q=` (case-insensitive prefix on `razonSocial` or `identificacion`).

## 2. Inputs

- [SPEC-0031](../specs/0031-customer-catalog.md) — authoritative.
- [SPEC-0005](../specs/0005-shared-contracts.md) — `CustomerSchema` discriminated union.
- [SPEC-0011](../specs/0011-tenants-memberships-rbac.md) — permissions `customer.*`.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — identification rules.

## 3. Architecture decisions

| Decision                                                                                                                                          | Rationale                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| Discriminated by `tipoIdentificacion`. Per-branch required fields (e.g., `direccion` mandatory for 04, 05, 06; optional for 07 consumidor final). | Mirrors SRI XSD requirements.          |
| `identificacion` is stored as-is (the digits/string).                                                                                             | Single column; queries cheap.          |
| `@@unique([companyId, tipoIdentificacion, identificacion])`.                                                                                      | Prevent duplicates per tenant.         |
| Consumidor Final is a real row (tipoId=07, identificacion=9999999999999, razonSocial="CONSUMIDOR FINAL"). `ensureConsumidorFinal` is idempotent.  | Avoids special-casing in invoice flow. |
| Search uses `LOWER(razonSocial) LIKE LOWER($q                                                                                                     |                                        | '%')`or simple`ILIKE`Postgres; an index`(companyId, lower(razonSocial))` accelerates. | Fast for moderate catalogs. |
| Soft delete only (`deletedAt`).                                                                                                                   | Audit + invoice references stay valid. |

## 4. Phases

### Phase 1 — Model

```prisma
model Customer {
  id String @id @db.Char(26)
  companyId String
  tipoIdentificacion String  // "04"|"05"|"06"|"07"|"08"
  identificacion String
  razonSocial String
  direccion String?
  email String?
  telefono String?
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([companyId, tipoIdentificacion, identificacion])
  @@index([companyId, razonSocial])
}
```

Migration `billing_customers`.

### Phase 2 — Validation

`apps/api/src/customers/validate.ts`: a thin wrapper around `CreateCustomerSchema` from contracts that adds per-branch rules:

- 04: RUC modulo 11; `direccion` required.
- 05: cédula modulo 10; `direccion` required.
- 06: pasaporte regex; `direccion` required.
- 07: identificacion must equal `"9999999999999"`; razonSocial fixed; no email/telefono required.
- 08: identificacion 3–20 alphanumeric; razonSocial required.

### Phase 3 — Endpoints

- `GET /api/v1/customers?q=&tipoIdentificacion=&limit=&cursor=`.
- `GET /api/v1/customers/:id`.
- `POST /api/v1/customers` (`customer.create`).
- `PATCH /api/v1/customers/:id` (`customer.update`).
- `DELETE /api/v1/customers/:id` (`customer.delete`) — soft-delete.

### Phase 4 — Consumidor Final helper

`apps/api/src/customers/ensure-consumidor-final.ts`:

```ts
export const ensureConsumidorFinal = async (tx, companyId) => {
  return tx.customer.upsert({
    where: {
      companyId_tipoIdentificacion_identificacion: {
        companyId,
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
      },
    },
    update: {},
    create: {
      id: ulid(),
      companyId,
      tipoIdentificacion: "07",
      identificacion: "9999999999999",
      razonSocial: "CONSUMIDOR FINAL",
    },
  });
};
```

### Phase 5 — Tests

- Unit: per-branch validation positive + negative.
- Integration:
  - CRUD happy paths.
  - Duplicate (same tipo+id same company) → 409.
  - VIEWER cannot create/update/delete.
  - Cross-tenant probe: 404.
  - Search by `q=ABC` returns prefix matches.
  - `ensureConsumidorFinal` idempotent across runs.

## 5. Risks & mitigations

| Risk                                       | Mitigation                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Cédula/RUC checksum bugs.                  | Use the same algorithms from `@facturador/contracts/primitives` for consistency. |
| Performance on large catalogs.             | Index `(companyId, razonSocial)`; consider full-text search later.               |
| `deletedAt` rows reappearing in search.    | Default queries filter `deletedAt IS NULL`.                                      |
| Email accidentally treated as primary key. | Email is optional; not unique.                                                   |

## 6. Validation strategy

- All branch validations tested.
- CRUD endpoints tested per role.
- Search test seeds 5 customers, asserts hit count for `q`.

## 7. Exit criteria

- All SPEC-0031 ACs pass.
- `ensureConsumidorFinal` integrated for SPEC-0033 use.

## 8. Out of scope

- Import CSV — later.
- Geo / postal validation — out.
- Privacy export / delete (GDPR-style) — later.
