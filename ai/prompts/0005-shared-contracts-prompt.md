---
id: PROMPT-0005
spec: SPEC-0005
plan: PLAN-0005
tasks: TASKS-0005
title: Execute TASKS-0005 — Shared contracts (Zod)
---

# PROMPT-0005 — Execute shared contracts (Zod) package

You are an autonomous senior TypeScript engineer with deep Zod and domain-modelling expertise. Execute **TASKS-0005**: build `@facturador/contracts` as the single source of truth for cross-boundary validation.

---

## 1. Mandatory reading

1. `ai/specs/0005-shared-contracts.md` — authoritative spec.
2. `ai/plans/0005-shared-contracts-plan.md` — phases, decisions, risks.
3. `ai/tasks/0005-shared-contracts-tasks.md` — checklist (this is what you execute).
4. `ai/context/glossary.md` — **mandatory**. Every field name in every schema must use this vocabulary verbatim.
5. `docs/sri-facturacion-electronica-ecuador.md` — RUC/cédula/claveAcceso checksum algorithms; identification types; ambiente codes.
6. `ai/specs/0022-clave-acceso-generator.md` — clave de acceso algorithm details (re-implement the pure check inside `clave-acceso.ts`, or import a tiny helper from `@facturador/utils` if it already exists).
7. `ai/specs/0031-customer-catalog.md` — customer discriminated union fields.
8. `ai/specs/0032-invoice-domain.md`, `ai/specs/0033-invoice-emission-orchestrator.md` — invoice shapes.
9. `ai/specs/0020-sri-core-service-bootstrap.md` — SRI service-to-service shapes.
10. `ai/specs/0006-error-model-and-logging.md` — `ProblemDetail` shape.

If two sources conflict: spec > plan > tasks > best practice.

## 2. Scope guardrails

- ✅ Only create schemas listed in TASKS-0005. Do not invent fields.
- ❌ No business logic, no I/O, no `fs`, no `fetch`, no `crypto` except where checksums require it. Even checksums must be pure.
- ❌ No `any` or `unknown` escape hatches in domain schemas (allowed only inside generic helpers if absolutely necessary; document in review).
- ❌ Do not introduce a new ESLint rule override without justification.
- ❌ Never duplicate Prisma model shapes. The contract is the API surface.

## 3. Stack constraints

- Zod 3.x.
- TypeScript 5.x strict; `verbatimModuleSyntax: true`; `exactOptionalPropertyTypes: true`.
- ESM only.
- Vitest for unit tests.
- No additional runtime deps beyond Zod.

## 4. Code quality bar

- Each schema file exports both the schema and its `z.infer`ed type with a clear name (e.g., `LoginRequest`, `LoginRequestSchema`).
- Branded primitives use `.brand<"Name">()` to prevent accidental mixing.
- Discriminated unions use `z.discriminatedUnion("tipoIdentificacion", [...])` — never plain unions for branchy data.
- Domain `index.ts` re-exports both `*Schema` and `*` types.
- Tests use fixture builders for readability; no magic strings repeated more than 3×.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/contracts test` exits 0.
- Coverage ≥ 95% on this package.
- Consumer smoke test in `apps/api` exits 0 (imports `RucSchema` and `LoginRequestSchema` through their subpaths).
- Each checksum schema (RUC, cédula, claveAcceso) has at least one **failing-checksum** fixture test that the schema rejects.
- TypeScript compiles across the entire workspace (`pnpm -r typecheck` exits 0) after consumers are wired.

## 6. Security considerations

- Email is normalised to lowercase on parse — but the **raw** form is never logged or echoed back; this package only produces the normalised value.
- Schemas must NEVER include plaintext password storage shapes. `LoginRequestSchema` has a `password` field for input only; there is no response that echoes it.
- `ProblemDetailSchema` MUST allow `errors: SriMensajeSchema[]` — those mensajes are user-facing, sanitised by the API layer before serialisation.
- No PII patterns (e.g., card numbers) in fixtures or tests.

## 7. Deliverables

When TASKS-0005 is green, write `ai/reviews/0005-shared-contracts-review.md` with:

1. **Summary** — 5–10 lines.
2. **Files created / changed** — absolute paths.
3. **Validation evidence**:
   - `pnpm --filter @facturador/contracts test --coverage` summary (statement % per file).
   - Consumer smoke test output from `apps/api`.
   - `pnpm -r typecheck` clean output.
4. **Schema inventory**:
   - Table: domain → subpath → list of exported schemas.
5. **Deviations from spec/plan** — anything you adjusted.
6. **Risks observed** — e.g., "checksum algorithm has an edge case for new RUC ranges; documented in docs/sri-...".
7. **Security review** — confirm no I/O, no plaintext password storage shape, email lowercased on parse, errors schema only carries safe fields.
8. **Suggested follow-ups** — e.g., add `ClaveAccesoBranded` helpers that pretty-print in groups of 4 (UI utility — out of scope here).
9. **Sign-off checklist** — SPEC-0005 AC-1…AC-7 with ✅/❌.

## 8. Communication style

Concise replies in chat; full audit in the review.

## 9. Exit condition

- All TASKS-0005 boxes ticked.
- Coverage ≥ 95%.
- Consumer smoke test passes.
- Review file complete.

Begin.
