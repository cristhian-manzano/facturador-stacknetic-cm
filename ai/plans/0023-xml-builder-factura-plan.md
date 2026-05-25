---
id: PLAN-0023
spec: SPEC-0023
title: XML builder — factura V2.1.0 — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0023 — XML builder (factura V2.1.0)

> Implementation plan for [SPEC-0023](../specs/0023-xml-builder-factura.md). Depends on PLAN-0020/0022. Consumed by SPEC-0024 (signer) + SPEC-0033 (orchestrator).

## 1. Goal

Produce a canonical XML factura V2.1.0 that:

- Conforms to the SRI XSD `docs/sri/factura/factura_V2.1.0.xsd`.
- Has a root `<factura id="comprobante" version="2.1.0">` for XAdES enveloped signing.
- Has stable element ordering (XSD-defined order; no map iteration drift).
- Encodes Spanish text safely (no invalid XML chars; descriptions sanitised; ≤ 300 chars / no `\n`).
- Uses `toFixed(2)` for monetary amounts and `toFixed(6)` for quantities / unit prices, per SRI rules.
- Is validated against the XSD using `libxmljs2` (or `xmllint` wrapper) before returning.

## 2. Inputs

- [SPEC-0023](../specs/0023-xml-builder-factura.md) — authoritative.
- [docs/sri/factura/factura_V2.1.0.xsd](../../docs/sri/factura/factura_V2.1.0.xsd) — canonical XSD.
- [docs/sri-facturacion-electronica-ecuador.md](../../docs/sri-facturacion-electronica-ecuador.md) — IVA rates, tax codes.
- [SPEC-0022](../specs/0022-clave-acceso-generator.md) — claveAcceso source.
- [SPEC-0032](../specs/0032-invoice-domain.md) — Invoice shape.

## 3. Architecture decisions

| Decision                                                                                                                                                                                                                                                              | Rationale                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Hand-rolled builder** producing a single string; do not use `xmlbuilder2`'s dynamic API for the root structure. Why: total control over attribute order and avoid surprise namespace declarations interfering with XAdES. We may use a thin string-template helper. | Predictable bytes for signing.                                        |
| Use `@xmldom/xmldom` only as a validation aid (parse → re-serialize → compare).                                                                                                                                                                                       | Canonicalisation is handled later by the signer.                      |
| Root: `<factura id="comprobante" version="2.1.0">`. **No XML declaration** in the input to the signer; some signers add it (handled in SPEC-0024). For storage we keep the declaration.                                                                               | Matches SRI signing examples.                                         |
| All monetary fields: `Decimal.toFixed(2)`. Quantity / unit price: `toFixed(6)`.                                                                                                                                                                                       | SRI tolerance ±0.01 enforced upstream; XML carries 2/6-place strings. |
| `descripcion` and other text fields sanitised: strip control chars except newline-not-allowed for descripcion (replace with space), cap length per XSD (`descripcion` ≤ 300). XML entities escaped.                                                                   | Avoid SRI parser errors.                                              |
| Element ordering driven by a TypeScript const array per section (no Map iteration).                                                                                                                                                                                   | Stable bytes.                                                         |
| No business calculations here. Builder consumes pre-computed totals from SPEC-0032's `computeInvoice`.                                                                                                                                                                | Single source of truth for math.                                      |
| Encoding: UTF-8 declared explicitly via `<?xml version="1.0" encoding="UTF-8"?>` for storage.                                                                                                                                                                         | Matches SRI examples.                                                 |

## 4. Phases

### Phase 1 — Pure builder

`apps/sri-core/src/xml/factura.ts`:

- Type `FacturaXmlInput` mirroring the resolved invoice domain (post-computeInvoice from SPEC-0032), enriched with company + customer + emission point.
- `buildFacturaXml(input): { xml: string, xmlForSigning: string }`.
- `xmlForSigning` omits the `<?xml ... ?>` declaration (the signer's input).
- Internal helpers per section: `infoTributaria`, `infoFactura`, `detalles`, `totalConImpuestos`, `pagos`, `infoAdicional`.

### Phase 2 — Sanitisation

`apps/sri-core/src/xml/sanitise.ts`:

- `escapeXml(s)`.
- `cleanDescripcion(s)`: trim, replace control chars + line breaks with space, cap at 300 chars.

### Phase 3 — Validation

`apps/sri-core/src/xml/validate.ts`:

- `validateAgainstXsd(xmlForSigning, schemaPath)`:
  - Uses `libxmljs2`. The schema file is copied into the sri-core image build context.
  - Returns `{ valid: boolean, errors: string[] }`.
- The builder calls this and throws `XmlBuildError({ code: "XSD_INVALID", errors })` on failure.

### Phase 4 — Tests

- A golden fixture under `apps/sri-core/test/fixtures/factura/golden-01.xml` (synthetic).
- `buildFacturaXml(goldenInput)` → equals golden bytes (exact match).
- `validateAgainstXsd(golden)` returns `valid: true`.
- Inject a bad descripcion (with control chars) → builder sanitises → still valid.
- Inject a missing field → builder throws.

### Phase 5 — Consumers

- `apps/sri-core/src/lifecycle/build-step.ts` will call `buildFacturaXml` (added in SPEC-0026 / SPEC-0033 integration).

## 5. Risks & mitigations

| Risk                                                | Mitigation                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Whitespace differences invalidate signatures later. | Builder emits a deterministic byte sequence; XAdES uses Exclusive C14N to normalise; document expectations. |
| XSD version drift.                                  | Schema file committed in `docs/sri/factura/`; SRI bumps require a new spec.                                 |
| Floating-point rounding in totals.                  | Builder accepts pre-computed Decimal-derived strings, never `Number`.                                       |
| Encoding pitfalls (non-ASCII tildes).               | Output UTF-8; escape only XML special characters; never percent-encode.                                     |

## 6. Validation strategy

- Golden test: builder output bytes equal a checked-in canonical file.
- XSD test: `xmllint --schema ... goldenfile.xml --noout` returns 0.
- Sanitisation tests for descripcion edge cases.

## 7. Exit criteria

- All SPEC-0023 ACs pass.
- Golden fixture under version control.

## 8. Out of scope

- Notas de crédito / débito / retenciones — separate specs.
- RIDE PDF — later spec.
- Signing — SPEC-0024.
