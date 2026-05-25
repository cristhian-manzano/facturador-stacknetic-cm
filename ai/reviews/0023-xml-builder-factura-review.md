---
id: REVIEW-0023
spec: SPEC-0023
plan: PLAN-0023
tasks: TASKS-0023
title: XML builder (factura V2.1.0) — implementation review
status: complete
created: 2026-05-21
---

# REVIEW-0023 — XML builder (factura V2.1.0)

## 1. Summary

Implemented the canonical SRI factura V2.1.0 XML emitter, sanitisation, and
XSD validation per [SPEC-0023](../specs/0023-xml-builder-factura.md). The
builder is pure, deterministic, byte-stable, and validates against the SRI
schema bundled under `apps/sri-core/resources/`. Sanitisation centralises
control-char stripping + descripcion truncation + XML escaping. Validation
runs through `xmllint-wasm` (selected because `libxmljs2` does not build
on Node 22 + macOS — see §5.1). A golden fixture committed under both
`apps/sri-core/test/golden/factura-golden-01.xml` and
`apps/sri-core/test/fixtures/factura/golden-01.xml` proves byte
determinism end-to-end.

## 2. Files created / changed

### New files

- `packages/contracts/src/sri/factura-input.ts` — `FacturaXmlInputSchema`
  (Zod) mirroring the XSD complex types we currently support (factura
  v1 milestone).
- `packages/contracts/src/sri/factura-input.test.ts` — Zod boundary tests.
- `apps/sri-core/src/xml/sanitise.ts` — `escapeXml`, `cleanDescripcion`,
  `cleanSingleLineText`.
- `apps/sri-core/src/xml/sanitise.test.ts` — unit tests.
- `apps/sri-core/src/xml/factura.ts` — `buildFacturaXml(input) →
{xml, xmlForSigning}`, `XmlBuildError`.
- `apps/sri-core/src/xml/factura.test.ts` — golden + sanitisation +
  numeric + optional + negative tests.
- `apps/sri-core/src/xml/validate.ts` — `validateAgainstXsd(xml)` with
  memoised schema bundle, `getFacturaXsdPath` / `getXmldsigXsdPath`.
- `apps/sri-core/src/xml/validate.test.ts` — schema-resolution tests +
  pass/fail/tampered XML coverage.
- `apps/sri-core/resources/factura_V2.1.0.xsd` — runtime copy of
  `docs/sri/factura/factura_V2.1.0.xsd`.
- `apps/sri-core/resources/xmldsig-core-schema.xsd` — W3C public XML
  Digital Signature schema imported by the SRI factura XSD. Bundled
  locally so xmllint resolves the import offline.
- `apps/sri-core/scripts/copy-schemas.ts` — `prebuild` + `predev` +
  `pretest` script that asserts `docs/sri/factura/factura_V2.1.0.xsd`
  is mirrored into `apps/sri-core/resources/`.
- `apps/sri-core/scripts/copy-resources.mjs` — `postbuild` script that
  copies `resources/` into `dist/resources/` so the shipped artifact
  contains the schema (TASKS-0023 §5.1).
- `apps/sri-core/scripts/smoke-factura.ts` — smoke runner; prints XML
  to stdout and XSD-validation status to stderr.
- `apps/sri-core/test/fixtures/factura/golden-01.input.json` — synthetic
  input (seed RUC `9990000015001`, deterministic claveAcceso, IVA 15%).
- `apps/sri-core/test/fixtures/factura/golden-01.xml` — golden bytes,
  also a copy of the file below.
- `apps/sri-core/test/golden/factura-golden-01.xml` — golden bytes
  (1 960 B; single-line; no LF).

### Edited files

- `packages/contracts/src/sri/index.ts` — re-export the new schemas.
- `apps/sri-core/package.json` — added `xmllint-wasm@4.0.2` dependency;
  `prebuild` + `postbuild` + `predev` + `pretest` scripts.
- `apps/sri-core/tsconfig.json` — include `scripts/**/*`.
- `apps/sri-core/Dockerfile` — copy `resources/` alongside `dist/` so
  validate.ts resolves the bundled XSD at runtime.

## 3. Validation evidence

### 3.1 Test suite (`pnpm --filter @facturador/sri-core test`)

```
 Test Files  16 passed (16)
      Tests  245 passed (245)
```

New XML tests inside that count:

- `src/xml/sanitise.test.ts` — 14
- `src/xml/factura.test.ts` — 22 (golden byte-eq, deterministic, XSD,
  sanitisation, truncation, escape, money/qty rounding, optional
  fields, negative paths)
- `src/xml/validate.test.ts` — 6 (positive, tampered root, missing
  detalles, schema-cache memoisation, resolved paths exist)

### 3.2 Coverage report

`pnpm --filter @facturador/sri-core test:coverage` — green:

| Folder        | % Stmts | % Branch | % Funcs | % Lines |
| ------------- | ------- | -------- | ------- | ------- |
| **src/xml**   | 97.74   | 86.2     | 100     | 97.74   |
| `factura.ts`  | 97.4    | 83.33    | 100     | 97.4    |
| `sanitise.ts` | 100     | 100      | 100     | 100     |
| `validate.ts` | 100     | 100      | 100     | 100     |
| **All files** | 91.44   | 81.21    | 95      | 91.44   |

Thresholds for `@facturador/sri-core` (config defaults): 85/75/85/85 —
all green. PROMPT-0023 "≥ 95% on `xml/*.ts`" is met at **97.74%**.

### 3.3 Golden diff

```
$ diff -u apps/sri-core/test/fixtures/factura/golden-01.xml \
          apps/sri-core/test/golden/factura-golden-01.xml
(no output — files are byte-identical)

$ wc -c apps/sri-core/test/golden/factura-golden-01.xml
1960 apps/sri-core/test/golden/factura-golden-01.xml
```

The byte-equality assertion runs inside
`src/xml/factura.test.ts > buildFacturaXml — happy path > matches the
checked-in golden bytes exactly`.

### 3.4 XSD validation

```
$ npx tsx apps/sri-core/scripts/smoke-factura.ts >/dev/null
XSD valid: yes
```

The same assertion runs inside `src/xml/validate.test.ts` (positive
case `returns valid:true for the golden xmlForSigning`).

### 3.5 Typecheck + build

`pnpm -r typecheck` and `pnpm -r build` are green, including the
`prebuild` + `postbuild` hooks that copy schemas into `dist/resources/`.

### 3.6 Validation matrix (PROMPT-0023 finishing line)

| Check                                       | Result |
| ------------------------------------------- | ------ |
| `pnpm --filter @facturador/sri-core test`   | PASS   |
| Deterministic build test                    | PASS   |
| Golden-file byte-eq test                    | PASS   |
| XSD validation test (positive)              | PASS   |
| Descripcion sanitisation test               | PASS   |
| Missing-required-field rejects (typed code) | PASS   |
| Numeric rounding test                       | PASS   |
| Accents preserved test                      | PASS   |
| `pnpm -r typecheck`                         | PASS   |
| `pnpm -r build`                             | PASS   |
| Smoke script prints well-formed XML         | PASS   |

## 4. Sanitisation rules table

| Field                                                                                                                                                                                                                       |                  Strip control chars                  | Collapse whitespace | Trim |                      Truncate                      |         Escape entities          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------: | :-----------------: | :--: | :------------------------------------------------: | :------------------------------: |
| `descripcion`                                                                                                                                                                                                               | yes (C0+DEL except `\t\n\r` which are then collapsed) | yes → single space  | yes  |                 yes (≤ 300 chars)                  |               yes                |
| `razonSocial`, `razonSocialComprador`, `nombreComercial`, `dirMatriz`, `dirEstablecimiento`, `direccionComprador`, `identificacionComprador`, `moneda`, `unidadTiempo`, `unidadMedida`, `codigoPrincipal`, `codigoAuxiliar` |                          yes                          | yes → single space  | yes  | no (Zod boundary already enforces XSD `maxLength`) |               yes                |
| `nombre` / `valor` on `detAdicional` and `campoAdicional`                                                                                                                                                                   |   no (Zod boundary enforces no-newline + maxLength)   |         no          |  no  |                         no                         | yes (attribute and text content) |
| Numeric money fields                                                                                                                                                                                                        |                          n/a                          |         n/a         | n/a  |               n/a (2dp `toFixed(2)`)               |               n/a                |
| Numeric qty fields                                                                                                                                                                                                          |                          n/a                          |         n/a         | n/a  |               n/a (6dp `toFixed(6)`)               |               n/a                |

Why these rules:

- The XSD `descripcion` is the only field that explicitly tolerates a
  silent truncation (SPEC-0023 §FR-6); every other free-text field is
  rejected by Zod if it exceeds the XSD `maxLength`.
- C0 controls minus TAB/LF/CR are scrubbed before whitespace
  collapsing — otherwise newlines would be deleted (creating word
  glue like `a\nb → ab`) instead of becoming a single space.
- The five XML entity escapes (`&` first, then `<`, `>`, `"`, `'`) are
  applied via `escapeXml`. The order matters: escaping `&` last would
  double-encode the entities written by earlier passes.

## 5. Element ordering

Element order is driven by **explicit const arrays per XSD `<xs:sequence>`**,
never by object-literal iteration. The arrays live in `factura.ts`:

- `INFO_TRIBUTARIA_ORDER`: `ambiente, tipoEmision, razonSocial,
nombreComercial?, ruc, claveAcceso, codDoc, estab, ptoEmi,
secuencial, dirMatriz, agenteRetencion?, contribuyenteRimpe?`.
- `INFO_FACTURA_ORDER`: `fechaEmision, dirEstablecimiento?,
contribuyenteEspecial?, obligadoContabilidad?,
tipoIdentificacionComprador, guiaRemision?, razonSocialComprador,
identificacionComprador, direccionComprador?, totalSinImpuestos,
totalDescuento, totalConImpuestos, propina?, importeTotal, moneda?,
pagos`.
- `DETALLE_ORDER`: `codigoPrincipal?, codigoAuxiliar?, descripcion,
unidadMedida?, cantidad, precioUnitario, descuento,
precioTotalSinImpuesto, detallesAdicionales?, impuestos`.
- `DETALLE_IMPUESTO_ORDER`: `codigo, codigoPorcentaje, tarifa,
baseImponible, valor`.
- `TOTAL_IMPUESTO_ORDER`: `codigo, codigoPorcentaje,
descuentoAdicional?, baseImponible, tarifa?, valor,
valorDevolucionIva?`.
- `PAGO_ORDER`: `formaPago, total, plazo?, unidadTiempo?`.

Optional fields ALWAYS render `""` (not `<tag/>`) when absent, satisfying
SPEC-0023 §FR-3.

## 6. Library choice (XML + XSD)

**XML emission:** hand-rolled string concatenation. Rationale:
predictable bytes (no namespace surprises), deterministic ordering, no
runtime parser to babysit. Output is single-line / no whitespace
between elements — eases C14N for the upcoming XAdES signer
(SPEC-0024).

**XSD validation:** `xmllint-wasm@4.0.2`. Original SPEC-0023 chose
`libxmljs2@^0.33.0` but its node-pre-gyp build fails on Node 22 + macOS
25 (`FastApiTypedArray was not declared in this scope`). The
`xmllint-wasm` fallback was explicitly authorised by PLAN-0023 §6.4
("If `libxmljs2` proves troublesome in the target environment, switch
to `xmllint-wasm` — the interface above is the contract regardless of
implementation"). Both are libxml2-based; only the host binding
changes.

## 7. XSD presence

- ✅ `docs/sri/factura/factura_V2.1.0.xsd` already committed.
- ✅ Bundled copy at `apps/sri-core/resources/factura_V2.1.0.xsd`,
  refreshed automatically via `prebuild`/`predev`/`pretest` script.
- ✅ Postbuild step mirrors `resources/` into `dist/resources/` so the
  shipped artifact carries it.
- ✅ Dockerfile copies `apps/sri-core/resources/` alongside `dist/` so
  the runtime image contains the XSD at
  `/app/apps/sri-core/resources/factura_V2.1.0.xsd` (also reachable via
  `/app/apps/sri-core/dist/resources/factura_V2.1.0.xsd`).
- ⚠️ The SRI factura XSD imports `xmldsig-core-schema.xsd` from the
  W3C namespace. That file is NOT shipped in `docs/sri/`; I committed a
  canonical W3C copy under `apps/sri-core/resources/xmldsig-core-schema.xsd`
  with attribution + URL in its header comment. SRI does not own this
  schema, so a separate copy is acceptable; if SRI ever updates the
  factura XSD to a different XMLDSig namespace, the comment URL is the
  source of truth.

## 8. Sample XML (first 30 lines)

The golden output is a single-line XML (1 960 bytes). The first 30
"elements" (wrapped for readability):

```
<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0">
  <infoTributaria>
    <ambiente>1</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>FACTURADOR DEMO S.A.</razonSocial>
    <nombreComercial>Facturador Demo</nombreComercial>
    <ruc>9990000015001</ruc>
    <claveAcceso>1905202601999000001500110010010000000011234567811</claveAcceso>
    <codDoc>01</codDoc>
    <estab>001</estab>
    <ptoEmi>001</ptoEmi>
    <secuencial>000000001</secuencial>
    <dirMatriz>Av. Demo 123, Quito, Ecuador</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>19/05/2026</fechaEmision>
    <dirEstablecimiento>Av. Demo 123, Quito, Ecuador</dirEstablecimiento>
    <obligadoContabilidad>SI</obligadoContabilidad>
    <tipoIdentificacionComprador>05</tipoIdentificacionComprador>
    <razonSocialComprador>Juan Pérez Ñandú</razonSocialComprador>
    <identificacionComprador>1710034065</identificacionComprador>
    <direccionComprador>Calle Florida 9-22, Cuenca</direccionComprador>
    <totalSinImpuestos>100.00</totalSinImpuestos>
    <totalDescuento>0.00</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>4</codigoPorcentaje>
        <baseImponible>100.00</baseImponible>
        ...
```

(The actual file is single-line; this is whitespace-formatted for the
review only.)

## 9. Deviations from spec/plan

| Item                                                                | Decision                                                                                            | Reason                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library: `libxmljs2` → `xmllint-wasm`                               | Documented fallback per PLAN-0023 §6.4 + §7.2                                                       | `libxmljs2` won't compile on Node 22 + macOS 25; xmllint-wasm is pure WASM and uses the same libxml2 engine.                                          |
| `xml/factura.ts` lives under `apps/sri-core/src/xml/`               | Matches TASKS-0023 §1.1 verbatim                                                                    | Spec §6.1 also proposed `apps/sri-core/src/documents/factura/`; TASKS won.                                                                            |
| Golden file path                                                    | Both `test/golden/factura-golden-01.xml` (PROMPT) and `test/fixtures/factura/golden-01.xml` (TASKS) | The two specs name different paths; we ship both and assert they're byte-equal.                                                                       |
| `xmldsig-core-schema.xsd` not in `docs/sri/`                        | Bundled a canonical W3C copy under `apps/sri-core/resources/`                                       | The SRI factura XSD imports it; without it, libxml2 refuses to compile the schema. The file is public and stable; we attribute the URL in its header. |
| `propina` and `obligadoContabilidad` are emitted only when provided | Followed XSD `minOccurs="0"` strictly                                                               | SPEC-0023 §FR-3: never emit empty elements.                                                                                                           |

## 10. Risks observed

- **Upcoming SRI schema bumps.** The XSD bundled is V2.1.0. If SRI
  publishes V2.2.0+, `prebuild` will copy the new file but XSD
  validation may flag historical fixtures. Mitigation: add a CI check
  that diffs `docs/sri/factura/factura_V2.1.0.xsd` vs
  `apps/sri-core/resources/factura_V2.1.0.xsd` — already implicit via
  the `copy-schemas` script's content check.
- **Whitespace handling for the signer.** The builder emits no
  inter-element whitespace, which is what XAdES C14N expects for a
  predictable digest. If anything later (xmlbuilder2, pretty-printer)
  re-formats the XML, the signature will silently break. The builder
  emits `xmlForSigning` precisely so the signer can hash the exact
  bytes we produce.
- **`xmllint-wasm` cold start.** First validation in a process pays a
  ~150 ms WASM warm-up. The validator memoises the schema bundle but
  the libxml2 parser re-compiles the schema each call (libxml2
  internal). For the offline-build path this is fine; for the orchestrator
  hot path we should warm the validator on boot — see §12.
- **Comment hyphens in committed XSDs.** XML 1.0 forbids `--` inside
  comments. The bundled `xmldsig-core-schema.xsd` had to be lightly
  edited to remove a `--` sequence I introduced in my header. The
  canonical W3C content is untouched; only the comment is. Long-term
  follow-up: fetch the W3C copy programmatically and write it
  verbatim, leaving our metadata in a sibling README.

## 11. Security review

- ✅ `descripcion` is sanitised (control char strip + whitespace
  collapse + 300-char truncate) before XML escape — prevents control
  char poisoning and any byte the SRI parser would reject.
- ✅ All text values pass through `escapeXml`; attribute values use
  the same escape (so embedded `"` cannot break out of an attribute).
- ✅ The XSD path is resolved from a known location (`getFacturaXsdPath`)
  using `import.meta.url`. The function takes no parameter; request
  input never reaches the validator's path. PLAN-0023 §6.4 lists this
  as a hard rule.
- ✅ The builder logs nothing. The orchestrator (SPEC-0033) will log
  through the existing `@facturador/logger` which already redacts
  `signedXml`. We will add `xmlForSigning` and `xml` to `REDACT_PATHS`
  when the orchestrator wires it up — flagged in §12 as a follow-up.
- ✅ No external DTD or entity loading. `xmllint-wasm`'s default
  behaviour disables network fetching; the in-memory `preload` is the
  only side-channel and it carries our committed bytes.
- ✅ No `console.log` (lint-enforced).
- ✅ No `process.env` access in any file under `src/xml/`.

## 12. Suggested follow-ups

1. **Warm the XSD validator on boot.** Call `validateAgainstXsd("<factura
id=\"comprobante\" version=\"2.1.0\"/>")` once on service start so
   the first real document doesn't pay the WASM cold-start cost. Trivial
   to wire into `apps/sri-core/src/server.ts` boot path.
2. **Cache the parsed schema across calls.** `xmllint-wasm` re-compiles
   the schema per `validateXML` call. If we hit throughput bottlenecks
   we can pre-compile a libxml2 schema handle via a different API
   (likely requires forking `xmllint-wasm` or moving to
   `libxslt-wasm`).
3. **Add `xml` + `xmlForSigning` to `REDACT_PATHS`** in
   `@facturador/logger` config — the orchestrator must never log full
   XML bodies (PROMPT-0023 §6.0). We'll do this in the SPEC-0024
   wire-up.
4. **NC / ND / retencion builders.** Each gets its own spec (SPEC-002x
   placeholders in `0000-INDEX.md`). The skeleton in `factura.ts` plus
   the order arrays per `<xs:sequence>` should generalise; expect a
   `xml/nota-credito.ts` etc. with shared helpers.
5. **CI diff between `docs/sri/…/factura_V2.1.0.xsd` and
   `apps/sri-core/resources/factura_V2.1.0.xsd`.** The
   `copy-schemas.ts` script already covers the writable side; a
   read-only CI guard would catch drift introduced by editing only
   one of the two copies.
6. **Property-based tests for the builder.** Use fast-check (already
   in the monorepo for other modules) to fuzz: random tarifa, random
   number of detalles, random unicode descripciones. Asserts: builder
   never throws, every output XSD-validates, descripcion never
   exceeds 300 chars in the output.

## 13. Sign-off checklist (SPEC-0023 AC-1…AC-9)

- ✅ **AC-1.** Output starts with `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="2.1.0">`. (`src/xml/factura.test.ts > xml starts with the UTF-8 declaration`.)
- ✅ **AC-2.** Golden output passes `validateAgainstXsd`. (`src/xml/factura.test.ts > validates against the bundled SRI XSD`.)
- ✅ **AC-3.** Same input twice yields byte-identical output. (`src/xml/factura.test.ts > deterministic`.)
- ✅ **AC-4.** `<bad>&"'` is escaped properly. (`src/xml/factura.test.ts > escapes XML-special characters in razonSocialComprador`.)
- ✅ **AC-5.** Descripcion with `\n` is replaced by space before truncation. (`src/xml/factura.test.ts > collapses newline-laden descripcion`.)
- ✅ **AC-6.** Optional fields produce no corresponding XML element. (`src/xml/factura.test.ts > omits optional fields when absent`.)
- ✅ **AC-7.** `cantidad: 1.5` renders as `<cantidad>1.500000</cantidad>`. (`src/xml/factura.test.ts > formats cantidad and precioUnitario to exactly 6 decimals`.)
- ✅ **AC-8.** `valor: 15` renders as `<valor>15.00</valor>`. (golden fixture + numeric formatting tests.)
- ✅ **AC-9.** A clave-acceso with a bad checksum is rejected by the schema before reaching the builder. (`src/xml/factura.test.ts > throws INVALID_INPUT when claveAcceso checksum is wrong`.)

TASKS-0023 AC-1…AC-7 mirror the same evidence; all green.

## 14. Definition of Done

- [x] All TASKS-0023 boxes ticked.
- [x] Golden byte-equal, XSD valid.
- [x] Coverage on `xml/*.ts` ≥ 95% statements (97.74%).
- [x] `pnpm -r typecheck` and `pnpm -r build` green.
- [x] Smoke node script builds factura and prints to stdout.
- [x] No commits made (per PROMPT-0023 hard constraint).
