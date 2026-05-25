---
id: SPEC-0005
title: Shared contracts package (@facturador/contracts)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002]
blocks: [SPEC-0010, SPEC-0011, SPEC-0020, SPEC-0030, SPEC-0031, SPEC-0032, SPEC-0033, SPEC-0040]
---

# SPEC-0005 — Shared contracts (Zod)

## 1. Purpose

A single typed contract surface shared by **Web**, **API**, and **SRI Core**. Defines request/response schemas (HTTP DTOs), domain primitives (RUC, cédula, claveAcceso), and service-to-service envelopes. Zod is the source of truth; TypeScript types are derived.

This package guarantees that:

- If the Web sends a payload, the API rejects it with the same error shape Web expects.
- If the API calls SRI Core, both sides agree on the wire format.
- A schema breakage is a compile-time error across the workspace.

## 2. Scope

### 2.1 In scope

- `packages/contracts/` package: `@facturador/contracts`.
- Primitive validators: `RucSchema`, `CedulaSchema`, `PasaporteSchema`, `IdentificacionCompradorSchema`, `ClaveAccesoSchema`, `AmbienteSchema`, `EstabSchema`, `PtoEmiSchema`, `SecuencialSchema`, `FechaEmisionSchema`, `MoneySchema`, `MoneyQtySchema`.
- HTTP contracts (per `apps/api` route) — namespaced by domain (`auth`, `tenants`, `customers`, `invoices`, etc.).
- SRI-Core contracts — what API sends to SRI Core and vice versa.
- A uniform `ProblemDetailSchema` for errors (RFC 7807-like).
- A `Result<T, E>` helper type (not throwing helper).
- Exports: each domain has its own subpath export (tree-shakeable).

### 2.2 Out of scope

- Domain logic (calculations, business rules) — lives in the API.
- Database models — lives in Prisma schema ([SPEC-0004](./0004-database-and-prisma.md)).

## 3. Context & references

- [`ai/context/glossary.md`](../context/glossary.md) — terminology.
- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §4, §8 — RUC/cédula/clave-acceso formats and SRI rules.
- [SPEC-0006](./0006-error-model-and-logging.md) — references `ProblemDetailSchema`.

## 4. Functional requirements

- **FR-1.** A schema for every HTTP request/response body exchanged between Web↔API and API↔SRI Core.
- **FR-2.** Schemas live under domain folders: `src/<domain>/<name>.schema.ts`.
- **FR-3.** Types are exported via `z.infer<...>` aliases: `export type FooDto = z.infer<typeof FooSchema>;`.
- **FR-4.** Primitive validators reject invalid inputs **with the message tied to the SRI field**, e.g. `claveAcceso must be exactly 49 digits`.
- **FR-5.** Subpath exports per domain so Web can import only what it needs: `import { LoginRequestSchema } from "@facturador/contracts/auth";`.
- **FR-6.** A single `ProblemDetail` envelope used for all API errors:

  ```ts
  {
    type: string;        // urn:facturador:error:<code> | RFC URL
    title: string;       // short human-readable
    code: string;        // machine-readable, snake_case
    status: number;      // HTTP status
    detail?: string;     // user-safe extended explanation
    instance?: string;   // request id / correlation id
    errors?: Record<string, string[]>;  // field → messages (for 400s)
  }
  ```

## 5. Non-functional requirements

- **NFR-1.** Zero runtime dependencies other than `zod`.
- **NFR-2.** Bundle size for Web imports ≤ 25 KB gzipped (tree-shaken).
- **NFR-3.** All schemas have a `.parse` + `.safeParse` smoke test verifying both happy and unhappy paths.

## 6. Technical design

### 6.1 Package layout

```
packages/contracts/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # re-exports primitives + ProblemDetail
│   ├── primitives/
│   │   ├── ruc.ts
│   │   ├── cedula.ts
│   │   ├── pasaporte.ts
│   │   ├── identificacion-comprador.ts
│   │   ├── clave-acceso.ts
│   │   ├── ambiente.ts
│   │   ├── establecimiento.ts
│   │   ├── punto-emision.ts
│   │   ├── secuencial.ts
│   │   ├── fecha-emision.ts
│   │   └── money.ts
│   ├── error/
│   │   └── problem-detail.ts
│   ├── auth/
│   │   ├── login.ts
│   │   ├── me.ts
│   │   ├── tenant-switch.ts
│   │   └── index.ts
│   ├── tenants/
│   │   └── index.ts
│   ├── customers/
│   │   ├── create.ts
│   │   ├── list.ts
│   │   └── index.ts
│   ├── invoices/
│   │   ├── create.ts
│   │   ├── detail.ts
│   │   ├── list.ts
│   │   └── index.ts
│   └── sri/
│       ├── emit-document.ts
│       ├── document-status.ts
│       └── index.ts
└── test/                            # smoke tests per schema
```

### 6.2 `package.json` exports

```jsonc
{
  "name": "@facturador/contracts",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./auth": "./dist/auth/index.js",
    "./tenants": "./dist/tenants/index.js",
    "./customers": "./dist/customers/index.js",
    "./invoices": "./dist/invoices/index.js",
    "./sri": "./dist/sri/index.js",
    "./primitives": "./dist/primitives/index.js",
    "./error": "./dist/error/problem-detail.js",
  },
  "dependencies": {
    "zod": "^3.23.0",
  },
}
```

### 6.3 Primitives — exact rules

| Schema                          | Rule                                                                                                                                                     | Notes                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- | ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RucSchema`                     | 13 digits, last 3 digits `001` (sociedades) OR `00<n>` (personas naturales). Module-11 check for natural persons, module-11 (cycle 4..2) for sociedades. | Provide both `RucPersonaSchema`, `RucSociedadSchema` and a union `RucSchema`. |
| `CedulaSchema`                  | 10 digits, last digit module-10 check. First 2 digits 01..24 (province).                                                                                 | Reuse from `apps/api` domain util but defined here.                           |
| `PasaporteSchema`               | 1..20 alphanumeric.                                                                                                                                      | Lax — passport formats vary.                                                  |
| `IdentificacionCompradorSchema` | Tagged union by `tipo` (`'04'                                                                                                                            | '05'                                                                          | '06'          | '07' | '08'`). `07`(consumidor final) → identificacion must be`9999999999999`. | See [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §9. |
| `ClaveAccesoSchema`             | Exactly 49 digits. Validator also checks module-11 verifier digit on positions 1..48.                                                                    | Used by API + SRI Core.                                                       |
| `AmbienteSchema`                | `'1'                                                                                                                                                     | '2'`.                                                                         | Never coerce. |
| `EstabSchema`                   | 3 digits.                                                                                                                                                |                                                                               |
| `PtoEmiSchema`                  | 3 digits.                                                                                                                                                |                                                                               |
| `SecuencialSchema`              | 9 digits, zero-padded.                                                                                                                                   |                                                                               |
| `FechaEmisionSchema`            | Format `dd/mm/aaaa`, valid Gregorian, year 2000..2099.                                                                                                   |                                                                               |
| `MoneySchema`                   | `z.number().nonnegative().multipleOf(0.01)`, max 14 integer digits.                                                                                      | For monetary amounts.                                                         |
| `MoneyQtySchema`                | `z.number().nonnegative().multipleOf(0.000001)`, max 18 total digits.                                                                                    | For `cantidad`, `precioUnitario`.                                             |

### 6.4 Example primitive — `clave-acceso.ts`

```ts
import { z } from "zod";

const isValidModulo11 = (input: string): boolean => {
  if (input.length !== 49) return false;
  const base = input.slice(0, 48);
  const verifier = input.slice(48);
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = base.length - 1, w = 0; i >= 0; i--, w = (w + 1) % weights.length) {
    sum += Number(base[i]) * weights[w]!;
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? "0" : r === 10 ? "1" : String(r);
  return verifier === expected;
};

export const ClaveAccesoSchema = z
  .string()
  .regex(/^\d{49}$/, "claveAcceso debe tener exactamente 49 dígitos")
  .refine(isValidModulo11, { message: "claveAcceso con dígito verificador inválido" });

export type ClaveAcceso = z.infer<typeof ClaveAccesoSchema>;
```

### 6.5 Example HTTP contract — `auth/login.ts`

```ts
import { z } from "zod";

export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  csrfToken: z.string().min(1).optional(), // only for double-submit pattern
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    fullName: z.string(),
  }),
  memberships: z.array(
    z.object({
      companyId: z.string(),
      razonSocial: z.string(),
      role: z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"]),
    }),
  ),
  activeCompanyId: z.string().nullable(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

### 6.6 ProblemDetail

```ts
// src/error/problem-detail.ts
import { z } from "zod";

export const ProblemDetailSchema = z.object({
  type: z.string(),
  title: z.string(),
  code: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.record(z.array(z.string())).optional(),
});
export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;
```

### 6.7 SRI Core service contract (Web is **not** a client of this — only API is)

```ts
// src/sri/emit-document.ts
import { z } from "zod";
import {
  AmbienteSchema,
  ClaveAccesoSchema,
  EstabSchema,
  PtoEmiSchema,
  SecuencialSchema,
  FechaEmisionSchema,
} from "../primitives/index.js";

export const EmitDocumentRequestSchema = z.object({
  // Tenant context (mandatory; SRI Core uses it to pick the correct certificate).
  companyId: z.string(),
  // Document context
  ambiente: AmbienteSchema,
  codDoc: z.literal("01"), // factura for initial milestone; other codes added in their own specs
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema,
  claveAcceso: ClaveAccesoSchema,
  fechaEmision: FechaEmisionSchema,
  // Pre-validated business payload (factura).
  factura: z.unknown(), // refined in the factura-specific schema imported by SPEC-0023
});
export type EmitDocumentRequest = z.infer<typeof EmitDocumentRequestSchema>;

export const EmitDocumentResponseSchema = z.object({
  claveAcceso: ClaveAccesoSchema,
  estado: z.enum([
    "GENERADO",
    "FIRMADO",
    "ENVIADO",
    "RECIBIDA",
    "DEVUELTA",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "EN_PROCESO",
    "ERROR_RED",
  ]),
  mensajes: z
    .array(
      z.object({
        identificador: z.string(),
        mensaje: z.string(),
        informacionAdicional: z.string().optional(),
        tipo: z.enum(["ERROR", "ADVERTENCIA", "INFORMATIVO"]),
      }),
    )
    .optional(),
  numeroAutorizacion: z.string().optional(),
  fechaAutorizacion: z.string().datetime({ offset: true }).optional(),
  signedXmlSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type EmitDocumentResponse = z.infer<typeof EmitDocumentResponseSchema>;
```

### 6.8 Usage patterns

**API route handler** (Express 5):

```ts
import { LoginRequestSchema } from "@facturador/contracts/auth";

router.post("/api/v1/auth/login", async (req, res, next) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) return next(parsed.error); // central handler translates to ProblemDetail
  // ...
});
```

**Web form** (React Hook Form + zodResolver):

```ts
import { LoginRequestSchema } from "@facturador/contracts/auth";
const form = useForm({ resolver: zodResolver(LoginRequestSchema) });
```

## 7. Implementation guide

### 7.1 Steps

1. Scaffold `packages/contracts/` per §6.1.
2. Implement every primitive in `primitives/` with unit tests (`*.test.ts`).
3. Implement `error/problem-detail.ts`.
4. Implement `auth/`, `tenants/`, `customers/`, `invoices/`, `sri/` namespaces. For domain-specific schemas that aren't fully designed yet (e.g. invoice body), include `TODO(SPEC-0032)` placeholders typed as `z.unknown()`. These tighten up when downstream specs land.
5. Wire subpath exports in `package.json`.
6. Add `pnpm --filter @facturador/contracts test` to root pipeline.

### 7.2 Dependencies

| Package  | Version   | Purpose                |
| -------- | --------- | ---------------------- |
| `zod`    | `^3.23.0` | Runtime.               |
| `vitest` | `^2.1.0`  | Tests (devDependency). |

### 7.3 Conventions

- One schema per file, named `<Name>Schema` (PascalCase + `Schema` suffix).
- Type alias right below schema, named after the noun (no `Type` suffix): `export type Login = z.infer<typeof LoginSchema>;`.
- Every error message **in Spanish** when the message will reach an end user (validation messages for SRI fields). Internal error messages may be English.
- No business logic in this package. Validators only.

## 8. Acceptance criteria

- **AC-1.** Importing `@facturador/contracts/auth` in `apps/api` resolves and parses a valid request.
- **AC-2.** Module-11 check on `ClaveAccesoSchema` accepts a fixture of a known-valid clave and rejects a tampered last digit.
- **AC-3.** `RucSociedadSchema` accepts `1790012345001` and rejects `1790012345002`.
- **AC-4.** `CedulaSchema` accepts a fixture cédula `1710034065` and rejects `1710034066`.
- **AC-5.** `IdentificacionCompradorSchema` with `tipo: "07"` requires `identificacion === "9999999999999"`.
- **AC-6.** `pnpm --filter @facturador/contracts test` passes with coverage ≥ 90% in this package.
- **AC-7.** Tree-shaking: `apps/web` bundle reports `@facturador/contracts/primitives` ≤ 5 KB when only one primitive is imported.

## 9. Test plan

For each primitive: at minimum 3 valid + 3 invalid fixtures. Document expected error messages. Use real SRI test RUCs from the ficha técnica (synthetic only — never real-customer data).

## 10. Security considerations

- Schemas **must** cap string lengths to prevent unbounded memory use. Use `.max(...)` everywhere.
- `password` field length is capped at 200 to limit DoS via long hashes.
- The package itself has zero secrets and zero side effects.

## 11. Observability

Not applicable.

## 12. Risks and mitigations

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Drift between API runtime validation and Web type hints | Both consume the same `@facturador/contracts` package; type changes break both at compile time. |
| Spanish vs English error message inconsistency          | Convention §7.3 — Spanish for user-visible SRI fields.                                          |
| Schema growth bloats Web bundle                         | Subpath exports enforced; smoke test on Web bundle size in CI (later spec).                     |

## 13. Open questions

- Consider `zod-to-openapi` for auto-generating an OpenAPI spec for the API? Defer to a later spec; keep this package framework-free.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
