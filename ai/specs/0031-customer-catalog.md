---
id: SPEC-0031
title: Customer catalog
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0011]
blocks: [SPEC-0032, SPEC-0042]
---

# SPEC-0031 — Customer catalog

## 1. Purpose

Manage the receptor side of invoices: customers identified by RUC / cédula / pasaporte / `consumidor final`. Validate identification according to SRI rules so invalid customers can never enter an invoice payload.

## 2. Scope

### 2.1 In scope

- `Customer` model: tenant-scoped, soft-deletable.
- CRUD endpoints under `/api/v1/customers`.
- Validation:
  - Cédula: 10 digits, valid province (01..24), módulo 10 check digit.
  - RUC (sociedad): 13 digits ending in `001`, módulo 11 check digit on first 10.
  - RUC (persona natural): 13 digits ending in `001..009`, derived from a valid cédula.
  - Pasaporte: alphanumeric 1..20.
  - Consumidor final: `9999999999999`, `razonSocial="CONSUMIDOR FINAL"`, optional email.
- Sane defaults for "occasional" customers created on-the-fly during invoicing (the invoice form may post a `customer` inline or reference an `id`).

### 2.2 Out of scope

- Customer import (CSV) — later spec.
- Foreign customers with country-specific validation — covered minimally (Pasaporte path).

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §8, §9.
- [SPEC-0005](./0005-shared-contracts.md) §6.3 — primitives.

## 4. Functional requirements

- **FR-1.** Prisma model:

  ```prisma
  model Customer {
    id                String   @id
    companyId         String
    tipoIdentificacion String  // '04' RUC | '05' Cédula | '06' Pasaporte | '07' Consumidor final | '08' Identificación del exterior
    identificacion    String   // up to 20
    razonSocial       String
    nombreComercial   String?
    email             String?
    telefono          String?
    direccion         String?
    isActive          Boolean  @default(true)
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    deletedAt         DateTime?

    company           Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

    @@unique([companyId, tipoIdentificacion, identificacion])
    @@index([companyId, razonSocial])
    @@map("customers")
  }
  ```

- **FR-2.** Endpoints:

  ```
  GET    /api/v1/customers?q=&limit=&cursor=         customer.read    cursor-based list
  GET    /api/v1/customers/:id                       customer.read
  POST   /api/v1/customers                           customer.write   create
  PATCH  /api/v1/customers/:id                       customer.write
  DELETE /api/v1/customers/:id                       customer.write   soft delete (cannot delete if referenced by emitted invoice — but the FK is logical via id; we just keep history)
  ```

- **FR-3.** Validation (Zod schema in `@facturador/contracts/customers/create.ts`):

  ```ts
  import { z } from "zod";
  import { CedulaSchema, RucSchema, PasaporteSchema } from "../primitives/index.js";

  const Base = z.object({
    razonSocial: z.string().min(1).max(300),
    nombreComercial: z.string().max(300).optional(),
    email: z.string().email().max(254).optional(),
    telefono: z.string().max(40).optional(),
    direccion: z.string().max(300).optional(),
  });

  export const CreateCustomerSchema = z.discriminatedUnion("tipoIdentificacion", [
    Base.extend({ tipoIdentificacion: z.literal("04"), identificacion: RucSchema }),
    Base.extend({ tipoIdentificacion: z.literal("05"), identificacion: CedulaSchema }),
    Base.extend({ tipoIdentificacion: z.literal("06"), identificacion: PasaporteSchema }),
    Base.extend({
      tipoIdentificacion: z.literal("07"),
      identificacion: z.literal("9999999999999"),
      razonSocial: z.literal("CONSUMIDOR FINAL"),
    }),
    Base.extend({ tipoIdentificacion: z.literal("08"), identificacion: z.string().min(1).max(20) }),
  ]);

  export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;
  ```

- **FR-4.** `consumidor final` short-circuit: a singleton row per tenant with `identificacion = '9999999999999'` is created on tenant creation; UI invoices default to it for sub-$50 retail sales.

- **FR-5.** Uniqueness: `(companyId, tipoIdentificacion, identificacion)` is unique. Re-creating duplicates is `409 customer.duplicate`.

- **FR-6.** Search (`?q=`): case-insensitive `ILIKE %q%` on `razonSocial` OR `identificacion`. Cursor-based pagination with `?cursor=<lastId>&limit=20` (max 50).

## 5. Non-functional requirements

- **NFR-1.** List P95 ≤ 50 ms for ≤ 10k customers per tenant.
- **NFR-2.** Validation never silently coerces — wrong type means 400.

## 6. Technical design

### 6.1 Layout

```
apps/api/src/customers/
├── routes.ts
├── handlers/
│   ├── list.ts
│   ├── get.ts
│   ├── create.ts
│   ├── update.ts
│   └── delete.ts
└── services/
    └── consumidor-final.ts   # ensureConsumidorFinal(companyId)
```

### 6.2 `ensureConsumidorFinal`

Called at tenant creation ([SPEC-0011](./0011-tenants-memberships-rbac.md)) and idempotent on subsequent calls:

```ts
export const ensureConsumidorFinal = (companyId: string) =>
  prisma.customer.upsert({
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
```

### 6.3 Module-10 (cédula) and module-11 (RUC) checks

Implemented in `packages/utils/src/validation/`:

```ts
// cedula.ts (Cédula EC, módulo 10)
const PROVINCES = new Set(Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, "0")));
export const isValidCedula = (s: string): boolean => {
  if (!/^\d{10}$/.test(s)) return false;
  if (!PROVINCES.has(s.slice(0, 2))) return false;
  const third = Number(s[2]);
  if (third > 5) return false; // natural persons; 6..9 reserved
  const COEFS = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let p = Number(s[i]) * COEFS[i]!;
    if (p >= 10) p -= 9;
    sum += p;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(s[9]);
};

// ruc.ts (RUC sociedad módulo 11 with coefficients 4..2; persona natural derived from cédula)
export const isValidRucSociedad = (s: string): boolean => {
  if (!/^\d{13}$/.test(s)) return false;
  if (s.slice(10) !== "001") return false;
  const COEFS = [4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * COEFS[i]!;
  const r = 11 - (sum % 11);
  const check = r === 11 ? 0 : r === 10 ? 1 : r;
  return check === Number(s[9]);
};

export const isValidRucPersonaNatural = (s: string): boolean => {
  if (!/^\d{13}$/.test(s)) return false;
  if (!/^00[1-9]$/.test(s.slice(10))) return false;
  return isValidCedula(s.slice(0, 10));
};

export const isValidRuc = (s: string): boolean =>
  isValidRucSociedad(s) || isValidRucPersonaNatural(s);
```

Wire these into `@facturador/contracts/primitives/` (RucSchema, CedulaSchema use `.refine(isValidRuc / isValidCedula)`).

### 6.4 List handler with cursor

```ts
export const listCustomers: RequestHandler = async (req, res) => {
  const tenant = (req as any).tenant;
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(Number(req.query.limit ?? 20), 50);
  const cursor = req.query.cursor as string | undefined;

  const rows = await prisma.customer.findMany({
    where: {
      companyId: tenant.id,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { razonSocial: { contains: q, mode: "insensitive" } },
              { identificacion: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  res.json({ items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
};
```

## 7. Implementation guide

### 7.1 Steps

1. Add `Customer` model. Migrate.
2. Implement validation helpers in `packages/utils/src/validation/`. Wire to contracts.
3. Implement routes + handlers + service.
4. Update tenant-creation flow ([SPEC-0011](./0011-tenants-memberships-rbac.md)) to call `ensureConsumidorFinal`.
5. Tests:
   - Cedula table: 5 valid, 5 invalid.
   - RUC sociedad: 5 valid, 5 invalid.
   - RUC persona natural: 5 valid, 5 invalid.
   - Consumidor final upsert is idempotent.
   - Search by partial razonSocial returns results.
   - Tenant isolation: customer of tenant A not visible to tenant B.

### 7.2 Dependencies

(None new.)

### 7.3 Conventions

- All identification validation lives in `packages/utils/src/validation/` and `@facturador/contracts/primitives/`. Duplicates are bugs.

## 8. Acceptance criteria

- **AC-1.** Creating a customer with valid cédula succeeds; invalid cédula returns 400 with the cedula field error.
- **AC-2.** Creating a customer with `tipoIdentificacion=07` but `identificacion != "9999999999999"` returns 400.
- **AC-3.** Two customers with same `(tipoIdentificacion, identificacion)` for the same tenant: second returns 409 `customer.duplicate`.
- **AC-4.** Same identification across different tenants is allowed (isolation).
- **AC-5.** `ensureConsumidorFinal` returns the same row on a second call.
- **AC-6.** `GET /api/v1/customers?q=DEMO` returns customers whose razonSocial contains DEMO (case-insensitive).
- **AC-7.** Cursor pagination yields stable results across pages.

## 9. Test plan

- Per AC-1..AC-7 as integration tests.
- Property test: 10,000 random 10-digit strings: `isValidCedula` returns same as a reference implementation (port from the SRI docs).

## 10. Security considerations

- Email, telefono, direccion are PII; redacted in logs (see [SPEC-0006](./0006-error-model-and-logging.md) §6.3).
- Search by identificacion uses `contains` which can be expensive on large tables — index on `identificacion` is **not** unique (because the composite unique is `(companyId, tipoIdentificacion, identificacion)`); add a `(companyId, identificacion)` btree for search efficiency.

## 11. Observability

- Audit `customer.created`, `customer.updated`, `customer.deleted` with resource `customer:<id>`. No PII in metadata.

## 12. Risks and mitigations

| Risk                                   | Mitigation                                     |
| -------------------------------------- | ---------------------------------------------- |
| Validation gaps allow bad RUCs through | Pinned fixtures from SRI docs; property tests. |
| PII leakage in logs                    | Redaction in logger; PRs reviewed.             |

## 13. Open questions

- Bulk import / CSV upload? Out of scope for milestone; can be a later spec.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
