---
id: SPEC-0032
title: Invoice (factura) domain model
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0011, SPEC-0030, SPEC-0031]
blocks: [SPEC-0033, SPEC-0042, SPEC-0043]
---

# SPEC-0032 — Invoice (factura) domain model

## 1. Purpose

Define the **business** representation of a `factura` on the API side: persistence, validation rules, arithmetic. This is the "pre-XML" form that the orchestrator ([SPEC-0033](./0033-invoice-emission-orchestrator.md)) hands to SRI Core. **All money math** happens here; the builder + signer in SRI Core are pure transformers.

## 2. Scope

### 2.1 In scope

- `Invoice`, `InvoiceLine`, `InvoicePayment`, `InvoiceAdicional` models.
- Invoice status fields (separate from SRI Core's `SriDocument.estado`): `BORRADOR | EMITIDO | ANULADO`.
- Server-side recomputation of totals, taxes, and validation of payment sums.
- Tax catalog: which `(codigo, codigoPorcentaje, tarifa)` combos are valid for a given `fechaEmision` (IVA 15% from 2024-04-01, 12% before, 0%, exempt, no-objeto).
- API endpoints: list, get, create-draft, finalise (transition to EMITIDO triggers orchestrator).
- Read-only "preview totals" endpoint for the Web form.

### 2.2 Out of scope

- Sending to SRI — [SPEC-0033](./0033-invoice-emission-orchestrator.md).
- Cancelling a fiscal document at SRI (`anulación`) — separate process; out of milestone.
- Other doc types.

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §6, §8, §9 — XSD, formats, validations.
- [SPEC-0023](./0023-xml-builder-factura.md) — XML builder consumes a normalized payload that this spec produces.

## 4. Functional requirements

- **FR-1.** Prisma models:

  ```prisma
  model Invoice {
    id                     String   @id
    companyId              String
    estado                 InvoiceEstado @default(BORRADOR) // BORRADOR | EMITIDO | ANULADO
    emissionPointId        String
    customerId             String
    codDoc                 String   @default("01") // factura
    estab                  String   // 3 digits (cached from EmissionPoint at creation)
    ptoEmi                 String
    secuencial             String?  // null until finalise → reserved at orchestrator
    claveAcceso            String?  @unique // null until finalise
    fechaEmision           DateTime
    fechaEmisionLocal      String   // dd/mm/aaaa rendered with EC tz
    moneda                 String   @default("DOLAR")
    obligadoContabilidad   Boolean
    contribuyenteEspecial  String?
    totalSinImpuestos      Decimal  @db.Decimal(14,2)
    totalDescuento         Decimal  @db.Decimal(14,2) @default(0)
    propina                Decimal  @db.Decimal(14,2) @default(0)
    importeTotal           Decimal  @db.Decimal(14,2)
    createdAt              DateTime @default(now())
    updatedAt              DateTime @updatedAt
    deletedAt              DateTime?

    company                Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
    lines                  InvoiceLine[]
    payments               InvoicePayment[]
    adicionales            InvoiceAdicional[]

    @@index([companyId, estado, createdAt])
    @@map("invoices")
  }

  enum InvoiceEstado { BORRADOR EMITIDO ANULADO }

  model InvoiceLine {
    id                      String   @id
    invoiceId               String
    orden                   Int
    codigoPrincipal         String?
    codigoAuxiliar          String?
    descripcion             String
    unidadMedida            String?
    cantidad                Decimal  @db.Decimal(18,6)
    precioUnitario          Decimal  @db.Decimal(18,6)
    descuento               Decimal  @db.Decimal(14,2) @default(0)
    precioTotalSinImpuesto  Decimal  @db.Decimal(14,2)
    impuestos               Json     // [{ codigo, codigoPorcentaje, tarifa, baseImponible, valor }]

    invoice                 Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
    @@index([invoiceId, orden])
    @@map("invoice_lines")
  }

  model InvoicePayment {
    id          String   @id
    invoiceId   String
    formaPago   String   // catalog code
    total       Decimal  @db.Decimal(14,2)
    plazo       Decimal? @db.Decimal(14,2)
    unidadTiempo String?

    invoice     Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
    @@map("invoice_payments")
  }

  model InvoiceAdicional {
    id        String  @id
    invoiceId String
    nombre    String
    valor     String

    invoice   Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
    @@map("invoice_adicionales")
  }
  ```

- **FR-2.** Endpoints:

  ```
  GET    /api/v1/invoices?estado=&q=&cursor=                 invoice.read    cursor list
  GET    /api/v1/invoices/:id                                 invoice.read
  POST   /api/v1/invoices                                     invoice.create  create draft
  PATCH  /api/v1/invoices/:id                                 invoice.create  edit draft
  POST   /api/v1/invoices/:id/preview-totals                  invoice.create  recompute without persisting
  POST   /api/v1/invoices/:id/emit                            invoice.create  finalise → orchestrator (SPEC-0033)
  DELETE /api/v1/invoices/:id                                 invoice.create  hard-delete only BORRADOR
  ```

- **FR-3.** Server-side calculation rules (line):
  - `precioTotalSinImpuesto = round((cantidad * precioUnitario) - descuento, 2)`.
  - For each `<impuesto>`: `valor = round(baseImponible * tarifa / 100, 2)`. Tolerance ±0.01 vs client suggestion.
  - `baseImponible` for IVA equals `precioTotalSinImpuesto` (we keep the simple case for milestone — no detalle-level adicionales/discounts that change base).
- **FR-4.** Invoice totals:
  - `totalSinImpuestos = SUM(lines.precioTotalSinImpuesto)`.
  - `totalConImpuestos[i].baseImponible = SUM(lines where impuesto matches).baseImponible`.
  - `totalConImpuestos[i].valor = SUM(lines where impuesto matches).valor`.
  - `importeTotal = totalSinImpuestos - totalDescuento + SUM(totalImpuesto.valor) + propina`.
- **FR-5.** Payment sum check: `SUM(payments.total) === importeTotal` (tolerance ±0.01). Reject finalise if not.
- **FR-6.** IVA rate catalog (valid for `fechaEmision`):

  ```ts
  const IVA_CODES = {
    "0": { tarifa: 0, validFrom: null, label: "0%" },
    "2": { tarifa: 12, validFrom: null, validTo: "2024-03-31", label: "12% (histórico)" },
    "4": { tarifa: 15, validFrom: "2024-04-01", label: "15%" },
    "5": { tarifa: 5, validFrom: null, label: "5% construcción" },
    "6": { tarifa: 0, validFrom: null, label: "No objeto IVA" },
    "7": { tarifa: 0, validFrom: null, label: "Exento" },
    "8": { tarifa: null, validFrom: null, label: "Diferenciado (otras)" },
  } as const;
  ```

  Server rejects an invoice line with `(codigoPorcentaje, fechaEmision)` outside its valid window.

- **FR-7.** Finalise (`POST /:id/emit`):
  - Loads draft.
  - Reserves `secuencial` via [SPEC-0030](./0030-emission-points-and-sequencing.md).
  - Computes `claveAcceso` via [SPEC-0022](./0022-clave-acceso-generator.md).
  - Persists `secuencial` and `claveAcceso` on the invoice.
  - Hands off to orchestrator ([SPEC-0033](./0033-invoice-emission-orchestrator.md)).
  - On orchestrator success → `estado = EMITIDO`.
  - On orchestrator hard failure (`DEVUELTA`, `NO_AUTORIZADO`): leaves invoice in `BORRADOR`-equivalent state with linked `SriDocument` events visible; the operator decides whether to correct + re-emit (will reserve new secuencial and burn the old).
- **FR-8.** Draft updates: only allowed when `estado = BORRADOR`. Any update to an EMITIDO invoice is rejected.

## 5. Non-functional requirements

- **NFR-1.** Decimal math uses native `Decimal` via Prisma; in app code, use `decimal.js`/`big.js` (avoid float drift). All calculations through `packages/utils/src/money/`.
- **NFR-2.** Preview totals endpoint ≤ 50 ms for ≤ 50 lines.
- **NFR-3.** Finalise endpoint synchronous wait for orchestrator's best-effort path ≤ 5 s.

## 6. Technical design

### 6.1 Layout

```
apps/api/src/invoices/
├── routes.ts
├── handlers/
│   ├── list.ts
│   ├── get.ts
│   ├── create.ts
│   ├── update.ts
│   ├── preview-totals.ts
│   └── emit.ts
├── services/
│   ├── compute-totals.ts        # pure
│   ├── validate-payload.ts      # business validations
│   └── repository.ts
packages/utils/src/money/
├── round.ts                     # bankers rounding alt — but SRI just uses standard 2-decimal rounding; use Math-equivalent
└── decimal.ts                   # decimal.js wrapper
```

### 6.2 `compute-totals.ts`

```ts
import Decimal from "decimal.js";

type Line = {
  cantidad: string | number;
  precioUnitario: string | number;
  descuento: string | number;
  impuestos: { codigo: string; codigoPorcentaje: string; tarifa: number }[];
};

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export const computeLine = (l: Line) => {
  const subtotal = new Decimal(l.cantidad).mul(l.precioUnitario).minus(l.descuento);
  const precioTotalSinImpuesto = round2(subtotal);
  const impuestos = l.impuestos.map((i) => {
    const base = new Decimal(precioTotalSinImpuesto);
    const valor = round2(base.mul(i.tarifa).div(100));
    return { ...i, baseImponible: precioTotalSinImpuesto, valor };
  });
  return { precioTotalSinImpuesto, impuestos };
};

export const computeInvoice = (lines: Line[], propina = 0, totalDescuento = 0) => {
  let totalSinImpuestos = 0;
  const byImpuesto: Record<
    string,
    {
      codigo: string;
      codigoPorcentaje: string;
      tarifa: number;
      baseImponible: number;
      valor: number;
    }
  > = {};
  const enriched = lines.map((line) => {
    const c = computeLine(line);
    totalSinImpuestos = round2(new Decimal(totalSinImpuestos).plus(c.precioTotalSinImpuesto));
    for (const imp of c.impuestos) {
      const key = `${imp.codigo}|${imp.codigoPorcentaje}`;
      const existing = byImpuesto[key];
      if (existing) {
        existing.baseImponible = round2(
          new Decimal(existing.baseImponible).plus(imp.baseImponible),
        );
        existing.valor = round2(new Decimal(existing.valor).plus(imp.valor));
      } else {
        byImpuesto[key] = {
          codigo: imp.codigo,
          codigoPorcentaje: imp.codigoPorcentaje,
          tarifa: imp.tarifa,
          baseImponible: imp.baseImponible,
          valor: imp.valor,
        };
      }
    }
    return { ...line, ...c };
  });
  const totalConImpuestos = Object.values(byImpuesto);
  const sumImp = totalConImpuestos.reduce((a, b) => round2(new Decimal(a).plus(b.valor)), 0);
  const importeTotal = round2(
    new Decimal(totalSinImpuestos).minus(totalDescuento).plus(sumImp).plus(propina),
  );
  return { lines: enriched, totalSinImpuestos, totalConImpuestos, importeTotal };
};
```

### 6.3 `validate-payload.ts`

Performs all FR-3..FR-6 checks. Throws `AppError("invoice.totals_mismatch", 422, ..., errors: {...})` with field-level reasons when arithmetic doesn't reconcile or payment sum is off.

### 6.4 Contracts (in `@facturador/contracts/invoices/create.ts`)

```ts
import { z } from "zod";
import { IdentificacionCompradorSchema, MoneySchema, MoneyQtySchema } from "../primitives/index.js";

const LineSchema = z.object({
  codigoPrincipal: z.string().min(1).max(25).optional(),
  codigoAuxiliar: z.string().min(1).max(25).optional(),
  descripcion: z.string().min(1).max(300),
  unidadMedida: z.string().min(1).max(50).optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema.default(0),
  impuestos: z
    .array(
      z.object({
        codigo: z.enum(["2", "3", "5"]),
        codigoPorcentaje: z.string().regex(/^\d{1,4}$/),
        tarifa: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export const CreateInvoiceSchema = z
  .object({
    emissionPointId: z.string(),
    customerId: z.string().optional(),
    customer: z.unknown().optional(), // inline create — validated separately
    fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO local date; server formats to dd/mm/yyyy for XML
    lines: z.array(LineSchema).min(1).max(500),
    payments: z
      .array(
        z.object({
          formaPago: z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]),
          total: MoneySchema,
          plazo: MoneySchema.optional(),
          unidadTiempo: z.string().max(10).optional(),
        }),
      )
      .min(1),
    propina: MoneySchema.optional(),
    totalDescuento: MoneySchema.optional(),
    adicionales: z
      .array(z.object({ nombre: z.string().min(1).max(300), valor: z.string().min(1).max(300) }))
      .max(15)
      .optional(),
  })
  .refine((x) => x.customerId || x.customer, { message: "customerId or customer required" });
```

## 7. Implementation guide

### 7.1 Steps

1. Add Prisma models. Migrate.
2. Implement `compute-totals.ts` with property tests (sum of recomputed totals matches single-pass formula).
3. Implement `validate-payload.ts` with all rules.
4. Implement endpoints in the order: create draft → preview-totals → update → emit (the emit handler is a thin wrapper around [SPEC-0033](./0033-invoice-emission-orchestrator.md)).
5. Tests:
   - Create draft with valid payload → 201.
   - Create with mismatched totals (client-suggested vs computed) → 422 `invoice.totals_mismatch`.
   - Payment sum off by 0.02 → 422.
   - IVA `codigoPorcentaje=2` with `fechaEmision=2025-01-01` → 422 (12% deprecated).
   - Update draft after finalise → 409.

### 7.2 Dependencies

| Workspace                    | Package      | Version   | Purpose             |
| ---------------------------- | ------------ | --------- | ------------------- |
| `apps/api`, `packages/utils` | `decimal.js` | `^10.4.3` | Decimal arithmetic. |

### 7.3 Conventions

- All money in code: `Decimal`. Convert to `Number` only at API boundary (response).
- All "totals" are server-computed; the client may suggest values but the server's calculation wins. Wide-tolerance comparisons (±0.01) used only for input validation.

## 8. Acceptance criteria

- **AC-1.** Creating a draft with one line of `cantidad=1, precioUnitario=100, descuento=0`, IVA 15% returns `totalSinImpuestos=100, importeTotal=115`.
- **AC-2.** A draft cannot be created with `fechaEmision > today + 1day` → 422 `invoice.fecha_invalida`.
- **AC-3.** Payments summing 114.99 with importeTotal 115.00 → 422 `invoice.payment_mismatch`.
- **AC-4.** Emit reserves a sequential, computes claveAcceso, persists both, then invokes orchestrator.
- **AC-5.** A `VIEWER` calling `POST /invoices` returns 403.
- **AC-6.** Updates to an `EMITIDO` invoice return 409 `invoice.immutable`.
- **AC-7.** Preview-totals does **not** persist (assert by counting `prisma.invoice` rows before/after).

## 9. Test plan

- Property tests for `computeInvoice` (100 random valid line sets; importeTotal recomputed equals direct calculation).
- Boundary tests: max 500 lines.
- Time-window tests for IVA codes.

## 10. Security considerations

- Tenant isolation on every query.
- `customer` inline create path validates with [SPEC-0031](./0031-customer-catalog.md) schema; cannot reference a customer of another tenant.

## 11. Observability

- Audit `invoice.created`, `invoice.updated`, `invoice.emit_started`, `invoice.emit_finished` with claveAcceso and SRI estado.
- Log "totals computed" at debug.

## 12. Risks and mitigations

| Risk                                 | Mitigation                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Float drift in totals                | `Decimal` everywhere; reject if a client-supplied number does not match server computation by more than 0.01.                                                                            |
| Reserving a sequential then crashing | The sequential is burned (FR-7 of [SPEC-0030](./0030-emission-points-and-sequencing.md)) by a cleanup pass; until that exists, orphans are visible in the UI and can be manually burned. |

## 13. Open questions

- Allow draft "saved for later" beyond N days? Yes, no expiration for v1.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
