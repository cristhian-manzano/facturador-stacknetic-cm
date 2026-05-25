---
id: PROMPT-0023
spec: SPEC-0023
plan: PLAN-0023
tasks: TASKS-0023
title: Execute TASKS-0023 — XML builder (factura V2.1.0)
---

# PROMPT-0023 — Execute factura XML builder

You are an autonomous senior engineer with deep experience in XML, XSD, and SRI Ecuador's factura specification. Execute **TASKS-0023**: build the canonical factura V2.1.0 XML emitter, sanitisation, and XSD validation — all pure, deterministic, golden-tested.

---

## 1. Mandatory reading

1. `ai/specs/0023-xml-builder-factura.md` — authoritative.
2. `ai/plans/0023-xml-builder-factura-plan.md`.
3. `ai/tasks/0023-xml-builder-factura-tasks.md`.
4. `docs/sri/factura/factura_V2.1.0.xsd` — canonical schema. Element order in your builder MUST match this XSD.
5. `docs/sri-facturacion-electronica-ecuador.md` — IVA codes, tax rules.
6. `ai/specs/0022-clave-acceso-generator.md` — claveAcceso input shape.
7. `ai/specs/0032-invoice-domain.md` — invoice domain shape post-computeInvoice.
8. `ai/context/glossary.md` — Spanish field names must match verbatim.
9. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Pure builder + sanitisation + XSD validation. Nothing else.
- ❌ No signing, no SOAP, no business math, no I/O beyond reading the XSD file once for validation.
- ❌ No reliance on JSON.stringify ordering; element order comes from explicit code structures.
- ❌ No `Number` for money — strings already formatted by the caller.

## 3. Stack constraints

- TypeScript 5.x strict.
- `libxmljs2` (pin a known good version) for XSD validation.
- `@xmldom/xmldom` allowed only for parsing-roundtrip helpers.
- Node 22.

## 4. Code quality bar

- Element ordering driven by explicit const arrays per section. No Map iteration.
- Sanitisation centralised in `sanitise.ts`; never inlined.
- All input fields validated at function entry (length, format) and errors thrown with typed codes.
- Golden test fixture committed; the test asserts **byte equality**, not just XML equivalence (this matters for downstream signing predictability).
- No `console.log` (lint enforces).

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/sri-core test --coverage` exits 0; coverage on `xml/*.ts` ≥ 95%.
- Golden test byte-equals the checked-in `golden-01.xml`.
- `validateAgainstXsd(golden01.xmlForSigning, ...)` returns `valid: true`.
- Bad input fixtures throw typed errors.
- Sanitisation strips control chars and caps descripcion to 300 chars.
- The runtime image contains the XSD file at the expected path.

## 6. Security considerations

- Sanitise descripcion to prevent XML injection / control-char poisoning.
- Never include log lines containing the full XML body in production logs (REDACT_PATHS already masks `signedXml`; ensure `xmlForSigning` and `xml` are NOT logged anywhere — they may contain customer names).
- The XSD file path is resolved from a known location bundled with the app; never accept a path from request input.
- The builder must not interpolate user-supplied strings into attribute values without escaping.

## 7. Deliverables

When TASKS-0023 is green, write `ai/reviews/0023-xml-builder-factura-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Coverage report.
   - `diff -u` of golden vs builder output (must be empty).
   - XSD validation output.
4. **Sanitisation rules table** — what gets stripped, why.
5. **Element ordering** — section-by-section list of the order chosen.
6. **Deviations from spec/plan**.
7. **Risks observed** — e.g., upcoming SRI schema bumps; whitespace handling for the signer.
8. **Security review** — confirm sanitisation, no logging of XML body, schema path locked to bundled resource.
9. **Suggested follow-ups** — caching the parsed XSD; warming the validator on boot; adding NC / ND / retencion builders in future specs.
10. **Sign-off checklist** — SPEC-0023 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0023 boxes ticked.
- Golden byte-equal, XSD valid.
- Review file complete.

Begin.
