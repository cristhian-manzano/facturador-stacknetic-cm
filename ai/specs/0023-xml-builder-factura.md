---
id: SPEC-0023
title: XML builder — factura V2.1.0
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0005, SPEC-0020, SPEC-0022]
blocks: [SPEC-0024, SPEC-0026, SPEC-0033]
---

# SPEC-0023 — XML builder for factura V2.1.0

## 1. Purpose

Produce the canonical XML for a `factura` that:

1. Validates against `docs/sri/factura/factura_V2.1.0.xsd`.
2. Has the **exact** element order the XSD demands (`<xs:sequence>`).
3. Carries `id="comprobante"` on the root for the XAdES `Reference URI="#comprobante"` to resolve.
4. Has clean whitespace (single-line by convention) and UTF-8 without BOM, so canonicalization for signing is deterministic.

This module is **pure**: in → JS object validated by Zod; out → string. No I/O.

## 2. Scope

### 2.1 In scope

- `buildFacturaXml(input: FacturaXmlInput): string` — pure function.
- `FacturaXmlInputSchema` (Zod, in `@facturador/contracts/sri`) — strict schema with all SRI rules.
- Local XSD validation (`xmllint` via `libxmljs2` or pure JS `xsd-schema-validator` wrapper; chosen: `libxmljs2` for accuracy).
- Whitespace policy: single line; no comments; UTF-8 without BOM; XML declaration literal `<?xml version="1.0" encoding="UTF-8"?>`.
- Numeric formatting (2 vs 6 decimals).
- XML escaping of text values.

### 2.2 Out of scope

- Other doc types (NC, ND, retención) — separate specs.
- Signing — [SPEC-0024](./0024-xades-bes-signer.md).
- Business validations (aritmética, sequencing) — [SPEC-0032](./0032-invoice-domain.md).
- Inserting the clave de acceso — caller provides it.

## 3. Context & references

- [`docs/sri/factura/factura_V2.1.0.xsd`](../../docs/sri/factura/factura_V2.1.0.xsd) — **canonical**.
- [`docs/sri/factura/factura_V2.1.0.xml`](../../docs/sri/factura/factura_V2.1.0.xml) — illustrative sample.
- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §6, §8 — fields and formats.

## 4. Functional requirements

- **FR-1.** Input schema (Zod, lives in `@facturador/contracts/sri/factura-input.ts`) covers every element/attribute the XSD allows for factura V2.1.0. Optional elements are `.optional()` in Zod and omitted from XML when undefined.
- **FR-2.** Element order matches the XSD sequence. Reorderings are rejected by XSD validation.
- **FR-3.** No empty elements. If an optional value is absent, the element is omitted entirely (not `<placa></placa>`).
- **FR-4.** Decimals:
  - 2-decimal fields: render via `value.toFixed(2)` (string).
  - 6-decimal fields (`cantidad`, `precioUnitario`, `precioSinSubsidio`): render via `value.toFixed(6)`.
  - Use `Number` only at calculation time; never accept user-supplied strings.
- **FR-5.** Text values escaped: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`.
- **FR-6.** `descripcion` field of each `detalle` truncated to 300 chars; `\r` and `\n` replaced by single space; trailing/leading whitespace trimmed.
- **FR-7.** Output: ASCII single-line string, UTF-8 encoded when serialized to a buffer (`Buffer.from(xml, "utf8")`). No BOM.
- **FR-8.** XSD validation function `validateAgainstFacturaXsd(xml: string): { ok: true } | { ok: false; errors: string[] }`.

## 5. Non-functional requirements

- **NFR-1.** `buildFacturaXml` ≤ 5 ms for a 5-line invoice.
- **NFR-2.** Local XSD validation ≤ 30 ms.
- **NFR-3.** Determinism: same input → byte-identical output.

## 6. Technical design

### 6.1 Layout

```
apps/sri-core/src/documents/factura/
├── input-schema.ts        # re-export from @facturador/contracts/sri
├── builder.ts             # buildFacturaXml
├── xsd-validator.ts       # validateAgainstFacturaXsd
└── builder.test.ts
apps/sri-core/schemas/
└── factura_V2.1.0.xsd     # copied from docs/sri/ at build time
```

### 6.2 `FacturaXmlInputSchema` (sketch — must be exhaustive)

```ts
import { z } from "zod";
import {
  AmbienteSchema,
  ClaveAccesoSchema,
  EstabSchema,
  PtoEmiSchema,
  SecuencialSchema,
  FechaEmisionSchema,
  RucSociedadSchema,
  IdentificacionCompradorSchema,
  MoneySchema,
  MoneyQtySchema,
} from "../primitives/index.js";

const InfoTributariaSchema = z.object({
  ambiente: AmbienteSchema,
  tipoEmision: z.literal("1"),
  razonSocial: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/),
  nombreComercial: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/)
    .optional(),
  ruc: RucSociedadSchema,
  claveAcceso: ClaveAccesoSchema,
  codDoc: z.literal("01"),
  estab: EstabSchema,
  ptoEmi: PtoEmiSchema,
  secuencial: SecuencialSchema,
  dirMatriz: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/),
  agenteRetencion: z
    .string()
    .regex(/^\d{1,8}$/)
    .optional(),
  contribuyenteRimpe: z.literal("CONTRIBUYENTE RÉGIMEN RIMPE").optional(),
});

const TotalImpuestoSchema = z.object({
  codigo: z.enum(["2", "3", "5"]),
  codigoPorcentaje: z.string().regex(/^\d{1,4}$/),
  descuentoAdicional: MoneySchema.optional(),
  baseImponible: MoneySchema,
  tarifa: z.number().nonnegative().max(99.99).optional(),
  valor: MoneySchema,
  valorDevolucionIva: MoneySchema.optional(),
});

const PagoSchema = z.object({
  formaPago: z.enum(["01", "15", "16", "17", "18", "19", "20", "21"]),
  total: MoneySchema,
  plazo: MoneySchema.optional(),
  unidadTiempo: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[^\n]*$/)
    .optional(),
});

const InfoFacturaSchema = z.object({
  fechaEmision: FechaEmisionSchema,
  dirEstablecimiento: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/)
    .optional(),
  contribuyenteEspecial: z
    .string()
    .min(3)
    .max(13)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
  obligadoContabilidad: z.enum(["SI", "NO"]).optional(),
  tipoIdentificacionComprador: IdentificacionCompradorSchema.shape.tipo,
  guiaRemision: z
    .string()
    .regex(/^\d{3}-\d{3}-\d{9}$/)
    .optional(),
  razonSocialComprador: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/),
  identificacionComprador: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[^\n]*$/),
  direccionComprador: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\n]*$/)
    .optional(),
  totalSinImpuestos: MoneySchema,
  totalDescuento: MoneySchema,
  totalConImpuestos: z.array(TotalImpuestoSchema).min(1),
  propina: MoneySchema.optional(),
  importeTotal: MoneySchema,
  moneda: z.literal("DOLAR").optional(),
  pagos: z.array(PagoSchema).min(1),
});

const DetalleImpuestoSchema = z.object({
  codigo: z.enum(["2", "3", "5"]),
  codigoPorcentaje: z.string().regex(/^\d{1,4}$/),
  tarifa: z.number().nonnegative(),
  baseImponible: MoneySchema,
  valor: MoneySchema,
});

const DetAdicionalSchema = z.object({
  nombre: z.string().min(1).max(300),
  valor: z.string().min(1).max(300),
});

const DetalleSchema = z.object({
  codigoPrincipal: z
    .string()
    .min(1)
    .max(25)
    .regex(/^[^\n]*$/)
    .optional(),
  codigoAuxiliar: z
    .string()
    .min(1)
    .max(25)
    .regex(/^[^\n]*$/)
    .optional(),
  descripcion: z.string().min(1).max(300),
  unidadMedida: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[^\n]*$/)
    .optional(),
  cantidad: MoneyQtySchema,
  precioUnitario: MoneyQtySchema,
  descuento: MoneySchema,
  precioTotalSinImpuesto: MoneySchema,
  detallesAdicionales: z.array(DetAdicionalSchema).max(3).optional(),
  impuestos: z.array(DetalleImpuestoSchema).min(1),
});

const InfoAdicionalSchema = z
  .array(z.object({ nombre: z.string().min(1).max(300), valor: z.string().min(1).max(300) }))
  .max(15)
  .optional();

export const FacturaXmlInputSchema = z.object({
  infoTributaria: InfoTributariaSchema,
  infoFactura: InfoFacturaSchema,
  detalles: z.array(DetalleSchema).min(1),
  infoAdicional: InfoAdicionalSchema,
});

export type FacturaXmlInput = z.infer<typeof FacturaXmlInputSchema>;
```

> The schema above is a starting point. The implementer **must** open the XSD and cross-check every `<xs:element>`: if the XSD allows it, the schema accepts it; if the XSD disallows it, the schema rejects it. Reviewer compares element-by-element.

### 6.3 Builder strategy

Hand-rolled string concatenation, **not** a generic XML library. Reasons:

- Generic libraries (xmlbuilder2 etc.) introduce whitespace and order options that are hard to constrain.
- The builder is small (~200 LOC) and the output is well-defined.
- Snapshot tests make regressions impossible.

Sketch:

```ts
// apps/sri-core/src/documents/factura/builder.ts
import { FacturaXmlInputSchema, type FacturaXmlInput } from "./input-schema.js";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const t2 = (n: number) => n.toFixed(2);
const t6 = (n: number) => n.toFixed(6);

const sanitizeDescripcion = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 300);

const el = (tag: string, body: string) => `<${tag}>${body}</${tag}>`;
const elIf = (tag: string, value: string | number | undefined | null) =>
  value === undefined || value === null || value === ""
    ? ""
    : el(tag, typeof value === "number" ? String(value) : esc(String(value)));

export const buildFacturaXml = (input: FacturaXmlInput): string => {
  const i = FacturaXmlInputSchema.parse(input);

  const infoTrib = [
    el("ambiente", i.infoTributaria.ambiente),
    el("tipoEmision", i.infoTributaria.tipoEmision),
    el("razonSocial", esc(i.infoTributaria.razonSocial)),
    elIf("nombreComercial", i.infoTributaria.nombreComercial),
    el("ruc", i.infoTributaria.ruc),
    el("claveAcceso", i.infoTributaria.claveAcceso),
    el("codDoc", i.infoTributaria.codDoc),
    el("estab", i.infoTributaria.estab),
    el("ptoEmi", i.infoTributaria.ptoEmi),
    el("secuencial", i.infoTributaria.secuencial),
    el("dirMatriz", esc(i.infoTributaria.dirMatriz)),
    elIf("agenteRetencion", i.infoTributaria.agenteRetencion),
    elIf("contribuyenteRimpe", i.infoTributaria.contribuyenteRimpe),
  ].join("");

  const totalImps = i.infoFactura.totalConImpuestos
    .map((t) =>
      el(
        "totalImpuesto",
        [
          el("codigo", t.codigo),
          el("codigoPorcentaje", t.codigoPorcentaje),
          elIf(
            "descuentoAdicional",
            t.descuentoAdicional !== undefined ? t2(t.descuentoAdicional) : undefined,
          ),
          el("baseImponible", t2(t.baseImponible)),
          elIf("tarifa", t.tarifa !== undefined ? t2(t.tarifa) : undefined),
          el("valor", t2(t.valor)),
          elIf(
            "valorDevolucionIva",
            t.valorDevolucionIva !== undefined ? t2(t.valorDevolucionIva) : undefined,
          ),
        ].join(""),
      ),
    )
    .join("");

  const pagos = el(
    "pagos",
    i.infoFactura.pagos
      .map((p) =>
        el(
          "pago",
          [
            el("formaPago", p.formaPago),
            el("total", t2(p.total)),
            elIf("plazo", p.plazo !== undefined ? t2(p.plazo) : undefined),
            elIf("unidadTiempo", p.unidadTiempo),
          ].join(""),
        ),
      )
      .join(""),
  );

  const infoFact = [
    el("fechaEmision", i.infoFactura.fechaEmision),
    elIf("dirEstablecimiento", i.infoFactura.dirEstablecimiento),
    elIf("contribuyenteEspecial", i.infoFactura.contribuyenteEspecial),
    elIf("obligadoContabilidad", i.infoFactura.obligadoContabilidad),
    el("tipoIdentificacionComprador", i.infoFactura.tipoIdentificacionComprador),
    elIf("guiaRemision", i.infoFactura.guiaRemision),
    el("razonSocialComprador", esc(i.infoFactura.razonSocialComprador)),
    el("identificacionComprador", esc(i.infoFactura.identificacionComprador)),
    elIf("direccionComprador", i.infoFactura.direccionComprador),
    el("totalSinImpuestos", t2(i.infoFactura.totalSinImpuestos)),
    el("totalDescuento", t2(i.infoFactura.totalDescuento)),
    el("totalConImpuestos", totalImps),
    elIf("propina", i.infoFactura.propina !== undefined ? t2(i.infoFactura.propina) : undefined),
    el("importeTotal", t2(i.infoFactura.importeTotal)),
    elIf("moneda", i.infoFactura.moneda),
    pagos,
  ].join("");

  const detalles = el(
    "detalles",
    i.detalles
      .map((d) =>
        el(
          "detalle",
          [
            elIf("codigoPrincipal", d.codigoPrincipal),
            elIf("codigoAuxiliar", d.codigoAuxiliar),
            el("descripcion", esc(sanitizeDescripcion(d.descripcion))),
            elIf("unidadMedida", d.unidadMedida),
            el("cantidad", t6(d.cantidad)),
            el("precioUnitario", t6(d.precioUnitario)),
            el("descuento", t2(d.descuento)),
            el("precioTotalSinImpuesto", t2(d.precioTotalSinImpuesto)),
            d.detallesAdicionales?.length
              ? el(
                  "detallesAdicionales",
                  d.detallesAdicionales
                    .map((a) => `<detAdicional nombre="${esc(a.nombre)}" valor="${esc(a.valor)}"/>`)
                    .join(""),
                )
              : "",
            el(
              "impuestos",
              d.impuestos
                .map((imp) =>
                  el(
                    "impuesto",
                    [
                      el("codigo", imp.codigo),
                      el("codigoPorcentaje", imp.codigoPorcentaje),
                      el("tarifa", t2(imp.tarifa)),
                      el("baseImponible", t2(imp.baseImponible)),
                      el("valor", t2(imp.valor)),
                    ].join(""),
                  ),
                )
                .join(""),
            ),
          ].join(""),
        ),
      )
      .join(""),
  );

  const infoAd = i.infoAdicional?.length
    ? el(
        "infoAdicional",
        i.infoAdicional
          .map((a) => `<campoAdicional nombre="${esc(a.nombre)}">${esc(a.valor)}</campoAdicional>`)
          .join(""),
      )
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<factura id="comprobante" version="2.1.0">` +
    `<infoTributaria>${infoTrib}</infoTributaria>` +
    `<infoFactura>${infoFact}</infoFactura>` +
    `${detalles}` +
    `${infoAd}` +
    `</factura>`
  );
};
```

### 6.4 Local XSD validation

```ts
// apps/sri-core/src/documents/factura/xsd-validator.ts
import { parseXml, parseXmlSchema } from "libxmljs2";
import path from "node:path";
import fs from "node:fs";

const xsdPath = path.resolve(__dirname, "../../../schemas/factura_V2.1.0.xsd");
const xsdDoc = parseXmlSchema(fs.readFileSync(xsdPath, "utf8"));

export const validateAgainstFacturaXsd = (
  xml: string,
): { ok: true } | { ok: false; errors: string[] } => {
  const doc = parseXml(xml);
  const ok = doc.validate(xsdDoc);
  return ok
    ? { ok: true }
    : { ok: false, errors: doc.validationErrors.map((e) => e.message ?? String(e)) };
};
```

If `libxmljs2` proves troublesome in the target environment, switch to `xmllint-wasm` (pure JS, no native build). The interface above is the contract regardless of implementation.

### 6.5 Decisions

- **No XML namespaces** beyond what the XSD imposes (signing namespace is added by the signer, not here).
- **No `xmlns:ds="..."` on `<factura>`** — the signer injects the `<ds:Signature>` and any namespaces it needs.
- **`id="comprobante"`** is mandatory and validated.

## 7. Implementation guide

### 7.1 Steps

1. Copy `docs/sri/factura/factura_V2.1.0.xsd` into `apps/sri-core/schemas/` at build time (script in `apps/sri-core/scripts/copy-schemas.ts`; runs in `prebuild` / `predev`).
2. Add `FacturaXmlInputSchema` to `packages/contracts/src/sri/factura-input.ts`.
3. Implement builder + xsd-validator per §6.
4. Snapshot tests (deterministic golden files) for at least:
   - Minimal invoice (1 line, IVA 15%).
   - Consumidor final invoice (`identificacionComprador = "9999999999999"`).
   - Invoice with `detallesAdicionales`.
   - Invoice with `infoAdicional`.
   - Invoice with multiple tax breakdowns (15% + 0%).
5. XSD-validation tests for each fixture.

### 7.2 Dependencies (apps/sri-core)

| Package        | Version   | Purpose                              |
| -------------- | --------- | ------------------------------------ |
| `libxmljs2`    | `^0.33.0` | XSD validation (native; preferred).  |
| `xmllint-wasm` | `^4.0.2`  | Fallback if `libxmljs2` won't build. |

### 7.3 Conventions

- Decimal formatting **always** via `toFixed`; never string interpolation of raw numbers.
- Optional fields: omit when undefined; never emit empty tags.
- Text values **always** through `esc()`.
- Long values truncated only for `descripcion` (per SRI rules); other fields validated by Zod and rejected if too long.

## 8. Acceptance criteria

- **AC-1.** `buildFacturaXml` returns a string starting with `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="2.1.0">`.
- **AC-2.** Output passes `validateAgainstFacturaXsd` for every fixture in §7.1.
- **AC-3.** Snapshot stability: building the same input twice in a test run yields identical output.
- **AC-4.** A description containing `<bad>&"'` is escaped properly.
- **AC-5.** A description with `\n` is replaced by space before truncation.
- **AC-6.** Optional fields not provided produce **no** corresponding XML element.
- **AC-7.** `cantidad: 1.5` renders as `<cantidad>1.500000</cantidad>`.
- **AC-8.** `valor: 15` (number) renders as `<valor>15.00</valor>`.
- **AC-9.** A clave-acceso with bad checksum is rejected by the schema before reaching the builder.

## 9. Test plan

- Builder unit tests with golden files: `apps/sri-core/test/fixtures/golden/factura.<case>.xml`.
- XSD validation tests for both happy and tampered XMLs (manually break the XSD-violating attribute → assert error).
- Determinism: build twice in a loop, compare bytes.

## 10. Security considerations

- The builder must not perform business logic. Caller pre-computes totals; builder is dumb.
- Truncating `descripcion` silently is acceptable for SRI compliance, but the truncation must be **logged at debug** with `originalLength` so operators can see when their data is too long.
- No external entity loading or DTDs — `libxmljs2` is invoked with safe defaults.

## 11. Observability

- Log `buildFacturaXml.success` with `claveAcceso`, `bytes`, `lineCount`.
- Log `factura.xsd.failed` with the (compact) list of error messages on validation failure.

## 12. Risks and mitigations

| Risk                            | Mitigation                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| XSD version drift               | Schema copied from `docs/sri/` to `apps/sri-core/schemas/` at build; a CI check compares them and fails if they diverge. |
| Whitespace bug breaks signature | Single-line output enforced; canonicalization done by signer, not here.                                                  |
| Future need to support v2.2.0   | Builder and schema namespaced per version; switch by config when SRI updates.                                            |

## 13. Open questions

- Generate the Zod schema from XSD automatically? Tooling exists (`xsd-to-zod` is third-party / WIP). Not worth the dependency for a single XSD; manual hand-port is reviewed against XSD. Re-evaluate when adding NC/ND/retención.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
