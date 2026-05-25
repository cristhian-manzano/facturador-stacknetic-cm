---
id: PROMPT-0033
spec: SPEC-0033
plan: PLAN-0033
tasks: TASKS-0033
title: Execute TASKS-0033 — Invoice emission orchestrator
---

# PROMPT-0033 — Execute invoice emission orchestrator

You are an autonomous senior backend engineer. Execute **TASKS-0033**: implement the api-side emit / reissue / refresh handlers that orchestrate the api ↔ sri-core flow and maintain the SRI mirror fields on the Invoice.

---

## 1. Mandatory reading

1. `ai/specs/0033-invoice-emission-orchestrator.md` — authoritative.
2. `ai/plans/0033-invoice-emission-orchestrator-plan.md`.
3. `ai/tasks/0033-invoice-emission-orchestrator-tasks.md`.
4. `ai/specs/0020-sri-core-service-bootstrap.md`, `0022`, `0026`, `0030`, `0031`, `0032` — all dependencies.
5. `ai/specs/0006-error-model-and-logging.md` — ProblemDetail, audit.
6. `ai/context/sri-domain.md` — high-level flow.
7. `ai/specs/0000-INDEX.md`.

## 2. Scope guardrails

- ✅ Only emit / reissue / refresh handlers and the supporting service code in `apps/api`.
- ❌ Do NOT implement RIDE PDF, anulación, email delivery.
- ❌ Do NOT accept `claveAcceso` from request inputs.
- ❌ Do NOT call SRI directly from api — always via sri-core service JWT.
- ❌ Do NOT bypass `requireSession` + `requireTenant` + `requirePermission`.

## 3. Stack constraints

- Express 5; Prisma 5; Zod (`@facturador/contracts/invoices`).
- `jsonwebtoken` for HS256 service JWT (same secret as sri-core).
- TypeScript strict; ESM only.

## 4. Code quality bar

- Emit handler is split: transactional reservation in one function, sri-core call + mirror update in another, both composed in the handler. This keeps each unit testable.
- `buildClaveAcceso` is called with exactly the fields persisted (no drift).
- The handler reuses `assertPaymentsMatchTotal` from SPEC-0032; no duplicate logic.
- All mirror updates use field-by-field set; no `data: { ...response }` spread that could leak unknown keys.

## 5. Validation requirement (the user's hard rule)

You must demonstrate:

- `pnpm --filter @facturador/api test apps/api/test/invoice-emit.test.ts` exits 0.
- All six integration scenarios in TASKS §4 are green.
- Idempotency: second emit is a no-op (assert sriDocument and burnedSecuencial row counts unchanged).
- Reissue creates a new BORRADOR; old invoice unchanged; burnedSecuencial row exists.
- Network failure path produces ERROR_RED with a 502 ProblemDetail.
- JWT shape (decoded in the test) matches `{aud:"sri-core", iss:"api", sub:companyId, exp:<=now+60s}`.

## 6. Security considerations

- `claveAcceso` always server-computed. Reject any user-supplied `claveAcceso` field.
- JWT mint uses `SERVICE_JWT_SECRET` from env (Zod-validated); never inline.
- Service JWT has `exp ≤ 60s`; clock skew ≤ 5s; never logged.
- audit rows include companyId, actorUserId, invoiceId, claveAcceso (it's public info on the printed factura), outcome, durationMs — never JWTs, never line bodies.
- All sri-core fetches forward `X-Request-Id` for traceability.
- No `process.env.*` access outside `apps/api/src/env.ts` and the JWT mint config (which itself reads from env.ts).
- Cross-tenant probes return 404 (do not leak existence).

## 7. Deliverables

When TASKS-0033 is green, write `ai/reviews/0033-invoice-emission-orchestrator-review.md` with:

1. **Summary**.
2. **Files created / changed**.
3. **Validation evidence**:
   - Test outputs.
   - Sample decoded JWT shape (token redacted; only claims visible).
   - Mirror field values before/after each scenario.
4. **Flow diagram** — text or ASCII showing the emit pipeline.
5. **Idempotency analysis** — what the handler does on the second emit and why.
6. **Deviations from spec/plan**.
7. **Risks observed** — secuencial burned without successful SRI submission; long-running sri-core call inside the request lifetime.
8. **Security review** — confirm §6.
9. **Suggested follow-ups** — async emit via worker queue; cancel button while waiting; retries with exponential backoff for transient sri-core errors at this layer too.
10. **Sign-off checklist** — SPEC-0033 AC-1…AC-7 ✅/❌.

## 8. Communication style

Concise chat; complete review.

## 9. Exit condition

- All TASKS-0033 boxes ticked.
- Six integration scenarios green.
- Review file complete.

Begin.
