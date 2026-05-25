# SRI domain context

High-level mental model of the Ecuadorian SRI electronic-invoicing domain, **offline scheme**. This file is intentionally shallow: rules and exact field layouts live in the official ficha técnica under [`docs/sri/`](../../docs/sri/) — do not restate them here and do not invent them.

## Scope

Only the **esquema offline** (offline scheme). Four document types, each with its own XSD under `docs/sri/`:

| Document            | Spanish                  | XSD file (current version in repo)                               |
| ------------------- | ------------------------ | ---------------------------------------------------------------- |
| Invoice             | Factura                  | `docs/sri/factura/factura_V2.1.0.xsd`                            |
| Credit note         | Nota de crédito          | `docs/sri/nota_credito/NotaCredito_V1.1.0.xsd`                   |
| Debit note          | Nota de débito           | `docs/sri/nota_debito/NotaDebito_V1.0.0.xsd`                     |
| Withholding receipt | Comprobante de retención | `docs/sri/comprobante_retencion/ComprobanteRetencion_V2.0.0.xsd` |

Each directory also ships a sample XML. Treat the XSD as the contract and the sample XML as an illustration, not a spec.

The full PDF (`FICHA TE_CNICA ... Versio_n 232.pdf`) is the canonical source of business rules. Read it **only** when the task requires it (XML generation, signing, authorization, state handling, error interpretation).

## Lifecycle of a document (offline scheme)

```text
 draft ──▶ generated ──▶ signed ──▶ sent ──▶ received ──▶ authorized
                                       │          │             │
                                       ▼          ▼             ▼
                                  rejected    rejected       no respuesta
                                                              (contingencia)
```

Terminology Claude should use consistently:

- **Clave de acceso** — 49-digit access key, computed from tenant + document metadata. Uniquely identifies a receipt. Computed, not assigned.
- **Recepción** — first web-service call: hand the signed XML to SRI; SRI validates and acknowledges.
- **Autorización** — second web-service call (or async response): SRI confirms the document is legally valid and returns a timestamp.
- **Contingencia** — the issuer emits with a contingency access key when SRI is unreachable; the document must later be re-sent and authorized. This is a fallback regulated by the ficha técnica, not a "retry" in the usual sense.
- **RIDE** (Representación Impresa del Documento Electrónico) — human-readable PDF/print representation, generated **after** authorization.

## State machine (to implement in SRI Core)

Observed states a document can hold in our system:

- `BORRADOR` — product-side only, not yet given to SRI Core.
- `GENERADO` — XML built, not signed.
- `FIRMADO` — signed XML ready.
- `ENVIADO` — sent to SRI recepción.
- `RECIBIDA` — SRI acknowledged reception (still pending authorization).
- `AUTORIZADO` — final success state.
- `NO_AUTORIZADO` — SRI rejected authorization.
- `DEVUELTA` — SRI rejected at recepción.
- `EN_CONTINGENCIA` — fallback flow active.

The precise transitions and retry windows must match the ficha técnica. Do not invent states; if an edge case is not covered here, stop and ask.

## Signing

- Standard: **XAdES-BES**, enveloped signature, inside the document XML.
- Signed with the tenant's PKCS#12 certificate issued by an accredited Ecuadorian CA.
- Signing lives only in SRI Core (see [security.md](./security.md)).

## Validation chain

Every outbound document must pass, in order:

1. Business validation in `apps/api` (consistent totals, customer identification rules, tenant sequence, etc.).
2. SRI Core build + XSD validation against the correct version under `docs/sri/`.
3. XAdES-BES signature.
4. SRI recepción.
5. SRI autorización.

A failure at step 2 is our bug, not SRI's. A failure at step 4/5 must be normalized into our error vocabulary before being returned to `apps/api` (the API and Web layers never parse raw SRI XML errors).

## Multi-tenant aspects tied to SRI

- `RUC` identifies the tenant at the SRI level.
- Each tenant has: one or more `establecimiento` codes, each with one or more `punto de emisión`, each with an independent numeric sequence per document type.
- Signing certificate is per tenant (sometimes per legal representative).
- Ambiente (environment) is per request: `1` = pruebas (testing), `2` = producción. Never hardcode; always derive from tenant configuration.

## Golden-file testing

SRI output (signed XML) is deterministic enough to be snapshot-tested. Fixture location: `apps/sri-core/test/fixtures/`. Use synthetic test RUCs only.

## Reference links in this repo

- [`docs/sri/`](../../docs/sri/) — canonical source (XSDs, sample XMLs, PDF).
- [glossary.md](./glossary.md) — Spanish tax/SRI terms with English equivalents.
