---
id: SPEC-0033
title: Invoice emission orchestrator (API)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on:
  [
    SPEC-0006,
    SPEC-0010,
    SPEC-0011,
    SPEC-0020,
    SPEC-0022,
    SPEC-0026,
    SPEC-0030,
    SPEC-0031,
    SPEC-0032,
  ]
blocks: [SPEC-0042, SPEC-0043]
---

# SPEC-0033 — Invoice emission orchestrator (API)

## 1. Purpose

End-to-end orchestrator on the API side that turns a draft invoice into an SRI-authorised receipt. This is the "happy path" the user will use first and the most-tested code path in the system.

```
[API]                        [SRI Core]
 │ ─validate draft──┐         │
 │ ─reserve seq────┘          │
 │ ─compute clave──┐          │
 │ ─persist invoice┘          │
 │ ─call SRI Core /v1/documents/emit ──────►
 │                            │ build → sign → recepción → autorización
 │                            │ persist SriDocument + events
 │ ◄────────── return state + clave + messages
 │ ─update Invoice.estado + persist link
```

## 2. Scope

### 2.1 In scope

- `emitInvoice(invoiceId, actorUserId)` orchestrator on API.
- Mint service JWT for SRI Core ([SPEC-0020](./0020-sri-core-service-bootstrap.md) §6.3).
- `SriCoreClient` wrapper (HTTP) for the three SRI Core endpoints.
- Idempotency at the API level: re-emitting an already-EMITIDO invoice is a no-op.
- Burn-and-reissue path: when SRI returns `DEVUELTA` or `NO_AUTORIZADO` for a non-correctable error, the operator can request "re-emit"; this burns the old sequential and reserves a new one.

### 2.2 Out of scope

- The SRI Core internals — those are [SPEC-0023](./0023-xml-builder-factura.md), [SPEC-0024](./0024-xades-bes-signer.md), [SPEC-0025](./0025-sri-soap-clients.md), [SPEC-0026](./0026-document-lifecycle-and-jobs.md).
- RIDE PDF / email — later specs.

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §12 — flow diagram.
- [SPEC-0032](./0032-invoice-domain.md) — invoice domain.
- [SPEC-0026](./0026-document-lifecycle-and-jobs.md) — SRI Core lifecycle.

## 4. Functional requirements

- **FR-1.** `emitInvoice` flow:

  1. Load invoice; assert `estado = BORRADOR`. (Idempotency: if already `EMITIDO` and SRI has it `AUTORIZADO`, return the existing state without action.)
  2. Validate payload with [SPEC-0032](./0032-invoice-domain.md) `validate-payload.ts` (defensive recompute).
  3. In a single DB transaction:
     - Reserve sequencial via [SPEC-0030](./0030-emission-points-and-sequencing.md).
     - Compute claveAcceso via [SPEC-0022](./0022-clave-acceso-generator.md) with a freshly-generated `codigoNumerico`.
     - Persist `secuencial`, `claveAcceso` on the invoice row.
  4. Build the `EmitDocumentRequest` payload (translate domain → contract):
     - `infoTributaria` from Company + claveAcceso.
     - `infoFactura` from Invoice + Customer.
     - `detalles` from InvoiceLines.
     - `infoAdicional` from InvoiceAdicionales.
  5. Call SRI Core `POST /v1/documents/emit` with a fresh JWT.
  6. Persist the returned `estado` and `numeroAutorizacion` (when present) on the invoice.
  7. Transition `Invoice.estado`:
     - `AUTORIZADO` → `EMITIDO`.
     - `NO_AUTORIZADO` / `DEVUELTA` → leave in `BORRADOR`. Surface mensajes in the response.
     - `EN_PROCESO` → `EMITIDO` with status banner ("pending authorisation").
     - `ERROR_RED` → `BORRADOR` (the caller may retry).
  8. Audit the outcome.

- **FR-2.** `POST /api/v1/invoices/:id/emit` is synchronous and may take up to ~5 s. Returns 200 with `{ estado, claveAcceso, mensajes?, numeroAutorizacion?, fechaAutorizacion? }`.

- **FR-3.** `POST /api/v1/invoices/:id/reissue` (after rejection): operator confirms; the old `claveAcceso` is unchanged in history; a new `Invoice` is created (cloned, status BORRADOR, no `secuencial`/`claveAcceso`) and immediately emit-flowed; the old `Invoice` is marked `ANULADO` with a `reissuedToInvoiceId` link; the old sequential is burned.

- **FR-4.** `SriCoreClient`:

  ```ts
  export class SriCoreClient {
    constructor(
      private readonly base: string,
      private readonly mintToken: (companyId: string) => string,
    ) {}

    async emit(request: EmitDocumentRequest): Promise<EmitDocumentResponse> {
      const token = this.mintToken(request.companyId);
      const res = await fetch(`${this.base}/v1/documents/emit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();
      if (!res.ok) throw mapSriCoreError(res.status, body);
      return EmitDocumentResponseSchema.parse(body);
    }

    // status, resend follow the same pattern
  }
  ```

  `mapSriCoreError` converts the `ProblemDetail` shape coming back into an `AppError` reusing the same codes (the API does not re-wrap SRI Core errors; it forwards them).

## 5. Non-functional requirements

- **NFR-1.** Synchronous emit ≤ 5 s P95 when SRI is responsive.
- **NFR-2.** No partial commits — sequential reservation + clave persistence + SRI call are observed atomically by the user. If the SRI Core call throws, the invoice row reverts to BORRADOR but the sequential remains burned (we book a `BurnedSecuencial` row in a follow-up step).

## 6. Technical design

### 6.1 Layout

```
apps/api/src/invoices/emit/
├── orchestrator.ts            # emitInvoice
├── translate-to-sri.ts        # domain → EmitDocumentRequest
└── sri-core-client.ts         # HTTP client for SRI Core
```

### 6.2 `translate-to-sri.ts` (sketch)

```ts
import type {
  Invoice,
  Customer,
  Company,
  InvoiceLine,
  InvoicePayment,
  InvoiceAdicional,
  EmissionPoint,
  Establecimiento,
} from "@prisma/client";
import type { EmitDocumentRequest } from "@facturador/contracts/sri";

export const translateInvoiceToSriRequest = (input: {
  company: Company;
  invoice: Invoice;
  customer: Customer;
  emissionPoint: EmissionPoint & { establecimiento: Establecimiento };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  adicionales: InvoiceAdicional[];
}): EmitDocumentRequest => ({
  companyId: input.company.id,
  ambiente: input.company.ambiente as "1" | "2",
  codDoc: "01",
  estab: input.emissionPoint.establecimiento.codigo,
  ptoEmi: input.emissionPoint.codigo,
  secuencial: input.invoice.secuencial!,
  claveAcceso: input.invoice.claveAcceso!,
  fechaEmision: input.invoice.fechaEmisionLocal,
  factura: {
    infoTributaria: {
      ambiente: input.company.ambiente as "1" | "2",
      tipoEmision: "1",
      razonSocial: input.company.razonSocial,
      nombreComercial: input.company.nombreComercial ?? undefined,
      ruc: input.company.ruc,
      claveAcceso: input.invoice.claveAcceso!,
      codDoc: "01",
      estab: input.emissionPoint.establecimiento.codigo,
      ptoEmi: input.emissionPoint.codigo,
      secuencial: input.invoice.secuencial!,
      dirMatriz: input.company.dirMatriz,
      contribuyenteRimpe: undefined,
    },
    infoFactura: {
      fechaEmision: input.invoice.fechaEmisionLocal,
      dirEstablecimiento: input.emissionPoint.establecimiento.direccion,
      contribuyenteEspecial: input.company.contribuyenteEspecial ?? undefined,
      obligadoContabilidad: input.company.obligadoContabilidad ? "SI" : "NO",
      tipoIdentificacionComprador: input.customer.tipoIdentificacion,
      razonSocialComprador: input.customer.razonSocial,
      identificacionComprador: input.customer.identificacion,
      direccionComprador: input.customer.direccion ?? undefined,
      totalSinImpuestos: Number(input.invoice.totalSinImpuestos),
      totalDescuento: Number(input.invoice.totalDescuento),
      totalConImpuestos: aggregateTaxes(input.lines),
      propina: Number(input.invoice.propina) || undefined,
      importeTotal: Number(input.invoice.importeTotal),
      moneda: "DOLAR",
      pagos: input.payments.map((p) => ({
        formaPago: p.formaPago as any,
        total: Number(p.total),
        plazo: p.plazo ? Number(p.plazo) : undefined,
        unidadTiempo: p.unidadTiempo ?? undefined,
      })),
    },
    detalles: input.lines.map((l) => ({
      codigoPrincipal: l.codigoPrincipal ?? undefined,
      codigoAuxiliar: l.codigoAuxiliar ?? undefined,
      descripcion: l.descripcion,
      unidadMedida: l.unidadMedida ?? undefined,
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precioUnitario),
      descuento: Number(l.descuento),
      precioTotalSinImpuesto: Number(l.precioTotalSinImpuesto),
      impuestos: l.impuestos as any[],
    })),
    infoAdicional: input.adicionales.length
      ? input.adicionales.map((a) => ({ nombre: a.nombre, valor: a.valor }))
      : undefined,
  },
});
```

### 6.3 `orchestrator.ts` (key flow)

```ts
import { prisma } from "../../db/client.js";
import { reserveSecuencial } from "../../billing/secuencial/reserve.js";
import { buildClaveAcceso, generateCodigoNumerico } from "@facturador/utils/clave-acceso";
import { translateInvoiceToSriRequest } from "./translate-to-sri.js";
import { sriCoreClient } from "./sri-core-client.js";
import { audit } from "../../audit/audit.js";
import { AppError } from "../../errors/app-error.js";

export const emitInvoice = async (invoiceId: string, actorUserId: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true, payments: true, adicionales: true },
  });
  if (!invoice) throw new AppError("invoice.not_found", 404, "Invoice not found");
  if (invoice.estado === "EMITIDO") return summarise(invoice);
  if (invoice.estado === "ANULADO") throw new AppError("invoice.anulado", 409, "Invoice anulada");

  const [company, customer, emissionPoint] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: invoice.companyId } }),
    prisma.customer.findUniqueOrThrow({ where: { id: invoice.customerId } }),
    prisma.emissionPoint.findUniqueOrThrow({
      where: { id: invoice.emissionPointId },
      include: { establecimiento: true },
    }),
  ]);

  // Reserve + clave (in a transaction with the invoice row)
  const codigoNumerico = generateCodigoNumerico();
  const updated = await prisma.$transaction(async (tx) => {
    const secuencial = await reserveSecuencialTx(tx, {
      companyId: company.id,
      emissionPointId: emissionPoint.id,
      codDoc: "01",
    });
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
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        secuencial,
        claveAcceso,
        estab: emissionPoint.establecimiento.codigo,
        ptoEmi: emissionPoint.codigo,
      },
    });
  });

  await audit({
    action: "invoice.emit_started",
    actorUserId,
    companyId: company.id,
    resource: `invoice:${invoiceId}`,
    metadata: { claveAcceso: updated.claveAcceso },
  });

  const request = translateInvoiceToSriRequest({
    company,
    invoice: updated,
    customer,
    emissionPoint,
    lines: invoice.lines,
    payments: invoice.payments,
    adicionales: invoice.adicionales,
  });
  let response;
  try {
    response = await sriCoreClient.emit(request);
  } catch (err) {
    await audit({
      action: "invoice.emit_finished",
      actorUserId,
      companyId: company.id,
      resource: `invoice:${invoiceId}`,
      metadata: { claveAcceso: updated.claveAcceso, error: (err as Error).message },
    });
    throw err;
  }

  const nextEstado =
    response.estado === "AUTORIZADO"
      ? "EMITIDO"
      : response.estado === "EN_PROCESO"
        ? "EMITIDO"
        : "BORRADOR";
  await prisma.invoice.update({ where: { id: invoiceId }, data: { estado: nextEstado } });
  await audit({
    action: "invoice.emit_finished",
    actorUserId,
    companyId: company.id,
    resource: `invoice:${invoiceId}`,
    metadata: { claveAcceso: updated.claveAcceso, estado: response.estado },
  });

  return response;
};
```

(`reserveSecuencialTx` is a transactional variant of [SPEC-0030](./0030-emission-points-and-sequencing.md) `reserveSecuencial` exposed via the same file.)

### 6.4 Reissue handler

```ts
export const reissueInvoice = async (invoiceId: string, actorUserId: string) => {
  const original = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (original.estado === "EMITIDO")
    throw new AppError("invoice.reissue_forbidden", 409, "Already authorized");

  // Burn the original sequential
  await burnSecuencial({
    companyId: original.companyId,
    emissionPointId: original.emissionPointId,
    codDoc: original.codDoc,
    secuencial: original.secuencial!,
    reason: "MANUAL_BURN",
    actorUserId,
  });

  // Clone draft (without secuencial/claveAcceso/estado)
  const clone = await cloneInvoiceAsDraft(original);

  // Emit
  await emitInvoice(clone.id, actorUserId);

  // Mark original anulado in our system (does NOT issue a SRI anulación — that's a separate flow)
  await prisma.invoice.update({ where: { id: invoiceId }, data: { estado: "ANULADO" } });
  return clone;
};
```

## 7. Implementation guide

### 7.1 Steps

1. Implement files in §6.
2. Add the `sriCoreClient` singleton in `apps/api/src/sri/index.ts` (using env `SRI_CORE_PUBLIC_URL` + the JWT minter from [SPEC-0020](./0020-sri-core-service-bootstrap.md)).
3. Wire `POST /api/v1/invoices/:id/emit` and `POST /api/v1/invoices/:id/reissue`.
4. Integration tests:
   - Happy path with stub SRI Core returning AUTORIZADO.
   - DEVUELTA path: invoice remains BORRADOR; sequential stays burned (review: do we burn on DEVUELTA too? **Yes** — DEVUELTA secuenciales are also burned per SRI rules).
   - Reissue: original ANULADO, new invoice EMITIDO.
   - SRI Core unreachable: invoice rolls back to BORRADOR; error code `sri.network`.

### 7.2 Dependencies

(None new.)

### 7.3 Conventions

- API never builds XML, never signs, never speaks SOAP. All of that is SRI Core's job.
- API trusts the contract; if SRI Core returns an unknown `estado`, we treat it as `sri.unknown_estado` and audit.

## 8. Acceptance criteria

- **AC-1.** Happy path: `POST /:id/emit` returns 200 with `estado: "AUTORIZADO"`, `numeroAutorizacion`, and the invoice's `estado` is now `EMITIDO`.
- **AC-2.** SRI Core network error: invoice remains `BORRADOR`, response is 503 `sri.network`, sequential is **not** rolled back (sequential is one-way).
- **AC-3.** DEVUELTA path: response has `estado: "DEVUELTA"` and mensajes; invoice remains `BORRADOR`.
- **AC-4.** Reissue: old invoice `ANULADO`, new invoice has new clave and is EMITIDO.
- **AC-5.** Re-emitting an already-EMITIDO invoice is a no-op (returns existing summary; no SRI Core call).
- **AC-6.** Audit log contains both `invoice.emit_started` and `invoice.emit_finished` with claveAcceso.
- **AC-7.** No request body containing the full XML traverses the API process (request to SRI Core is a JSON payload, not the XML — XML construction is internal to SRI Core).

## 9. Test plan

- Unit: `translateInvoiceToSriRequest` snapshot tests with known fixtures.
- Integration with `MSW` (Mock Service Worker) standing in for SRI Core.
- Negative: payload Zod failure surfaces a `validation.failed` error from SRI Core; API forwards it to the user.

## 10. Security considerations

- API mints a JWT with `sub = tenant:<companyId>` matching the invoice's company; SRI Core rejects mismatch.
- API never sees decrypted certificate material.
- The clave/numeroAutorizacion may be returned to the client (it's public per SRI's portal); other internals are not.

## 11. Observability

- `claveAcceso`, `companyId`, `invoiceId` are present on every log line related to emission.
- Metric (future): `invoice_emit_duration_ms`, `invoice_emit_outcome_total{estado}`.

## 12. Risks and mitigations

| Risk                                                              | Mitigation                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sequential reserved but request never sent (orchestrator crashes) | Sequential is burned. Operator sees it via "burned sequentials" view; can manually re-emit. |
| Duplicate emit due to retry                                       | Idempotent based on `Invoice.estado`; backend short-circuits.                               |
| SRI Core token leak                                               | 60 s expiry; secret in env / KMS.                                                           |

## 13. Open questions

- Provide an async (queue-based) emit for high-volume operators? Not for v1; the synchronous response is the simpler UX.
- Add per-tenant kill switch (no emissions, e.g. during incident)? Yes — `Company.emissionsEnabled` boolean; add in a follow-up small spec.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
