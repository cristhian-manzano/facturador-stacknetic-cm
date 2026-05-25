---
id: TASKS-0020
spec: SPEC-0020
plan: PLAN-0020
title: SRI Core service bootstrap — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0020 — SRI Core service bootstrap

> Checklist for [SPEC-0020](../specs/0020-sri-core-service-bootstrap.md) + [PLAN-0020](../plans/0020-sri-core-service-bootstrap-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ Never expose `Certificate.p12CiphertextB64` (or related crypto material) via any API response.
- ❌ Never log JWTs, certificate ciphertext, or signed XML (REDACT_PATHS must cover them).
- ❌ Never allow `SRI_STUB_MODE=true` to boot when `NODE_ENV=production`.
- ❌ Never accept a body `companyId` that mismatches the JWT `sub`.
- ✅ The state machine matrix is enforced by `canTransition`; direct `update({ data: { estado } })` outside the lifecycle helper is a defect.

## 1. Prisma additions

- [ ] **1.1** Append to `prisma/schema.prisma`: `SriEstado`, `SriEtapa` enums; `Certificate`, `SriDocument`, `SriEvent` models per PLAN §4 Phase 1.
      **Validate**: `pnpm prisma validate` exits 0.

- [ ] **1.2** Create migration: `pnpm prisma migrate dev --name sri_core_init`.
      **Validate**: migration SQL contains `CREATE TABLE "Certificate"`, `"SriDocument"`, `"SriEvent"`; `prisma migrate status` clean.

## 2. Env loader

- [ ] **2.1** Create `apps/sri-core/src/env.ts`:
      Zod schema (matches `.env.example` from SPEC-0003) including `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL`, `SRI_CORE_PORT`, `SRI_RECEPCION_URL_PRUEBAS|PROD`, `SRI_AUTORIZACION_URL_PRUEBAS|PROD`, `SRI_CERT_MASTER_KEY_HEX`, `SERVICE_JWT_SECRET`, optional `SRI_STUB_MODE=z.enum(["true","false"]).default("false")`. Refine: `STUB_MODE` cannot be `"true"` when `NODE_ENV==="production"`.
      Exports `env` parsed once at module load; throws on validation failure with a precise message.
      **Validate**: unit test asserts parse success on a good payload; assert refine rejection on the production+stub combo.

## 3. Service JWT

- [ ] **3.1** `apps/sri-core/src/auth/service-jwt.ts`:

  - `verifyServiceJwt(token: string)` using HS256 with secret from env; rejects if `alg !== "HS256"`, `aud !== "sri-core"`, `iss !== "api"`, expired, or `sub` missing.
  - Middleware `requireServiceJwt` reads `Authorization: Bearer <token>`; on failure 401; on success attach `req.service = { companyId: claims.sub }`.
    **Validate**: unit tests cover: valid token passes; tampered signature fails; expired token fails; wrong aud fails; wrong alg (alg:none, alg:RS256) rejected.

- [ ] **3.2** `apps/api/src/sri/client.ts`:
  - `mintServiceJwt({ companyId }): string` produces HS256 token with `aud=sri-core, iss=api, sub=companyId, exp=now+60s, iat, jti=ulid()`.
  - `sriCoreFetch(path, init)` helper attaches the JWT, forwards `X-Request-Id`, throws `UpstreamError` on non-2xx.
    **Validate**: unit test mints + verifies a round-trip with the same secret; `sriCoreFetch` test with MSW asserts the `Authorization` header is set.

## 4. Routes

- [ ] **4.1** `apps/sri-core/src/routes/health.ts`: `GET /healthz` returns `{ ok: true, service: "sri-core" }`.
      **Validate**: Supertest 200.

- [ ] **4.2** `apps/sri-core/src/routes/documents.ts`:
  - `POST /v1/documents/emit` validates body with `EmitRequestSchema`. Asserts `body.companyId === req.service.companyId` else `ForbiddenError`. Upserts SriDocument by `claveAcceso` (unique). Returns the persisted shape.
  - `GET /v1/documents/:claveAcceso/status` reads with `where: { claveAcceso, companyId: req.service.companyId }`. 404 if not found.
  - `POST /v1/documents/:claveAcceso/resend` re-enqueues per state machine.
    **Validate**: integration tests per task §6.

## 5. Lifecycle helpers

- [ ] **5.1** `apps/sri-core/src/lifecycle/transitions.ts`: `canTransition(from: SriEstado, to: SriEstado): boolean` per the SPEC-0026 matrix. **Pure** function.
      **Validate**: exhaustive matrix test asserts each (from,to) yields the expected boolean.

- [ ] **5.2** `apps/sri-core/src/lifecycle/events.ts`: `recordEvent(prisma, { documentId, etapa, estado, mensajes?, durationMs })`:
  - In a transaction, validates `canTransition(currentEstado, estado)` (or accepts the same state for idempotency — document choice).
  - Updates the document's `estado` to the new state.
  - Inserts an `SriEvent` row.
    **Validate**: integration test triggers PENDIENTE → FIRMADO → ENVIADO; subsequent illegal transition (e.g., PENDIENTE → AUTORIZADO directly) throws.

## 6. Integration tests (api ↔ sri-core)

- [ ] **6.1** Spawn sri-core with a test schema. Mint a JWT in the api test code. Call `/v1/documents/emit` with a valid `EmitRequest` fixture. Assert 200, body validates `EmitResponseSchema`, document row exists, at least one event exists.
      **Validate**: pass.

- [ ] **6.2** Repeat the call with the same `claveAcceso`: response refers to the same document (idempotent).
      **Validate**: row count remains 1.

- [ ] **6.3** Negative paths:
  - Missing Authorization → 401.
  - Wrong aud claim → 401.
  - JWT sub ≠ body.companyId → 403.
  - Body missing `claveAcceso` → 400.
    **Validate**: each returns the expected status with a valid `ProblemDetail`.

## 7. Stub mode

- [ ] **7.1** With `SRI_STUB_MODE=true` (dev only), `POST /v1/documents/emit` short-circuits to AUTORIZADO and writes a single `SriEvent { etapa: AUTHORIZE, estado: AUTORIZADO }`.
      **Validate**: test sets the env, observes the response.

- [ ] **7.2** With `NODE_ENV=production` + `SRI_STUB_MODE=true`, the service refuses to boot.
      **Validate**: a Vitest spawns the env loader with that combination and expects a thrown error mentioning "stub_mode_in_production".

## 8. Compose wiring & smoke

- [ ] **8.1** `.env` carries `SERVICE_JWT_SECRET=<base64-256-bit>` and `SRI_STUB_MODE=true` (dev).
      **Validate**: `docker compose up -d sri-core`; `curl -fsS localhost:3100/healthz` → 200.

- [ ] **8.2** Helper script `scripts/mint-service-jwt.ts` prints a JWT for `companyId=<arg>`; used in manual curl tests.
      **Validate**: `node scripts/mint-service-jwt.ts <ulid>` prints a non-empty token; `curl -H "Authorization: Bearer $TOKEN" localhost:3100/v1/documents/<claveAcceso>/status` returns 404 (because the document doesn't exist) or 200 if seeded.

## 9. Acceptance criteria

- [ ] AC-1: sri-core has its own Prisma models with proper indexes.
- [ ] AC-2: HS256 JWT service-to-service auth enforced; alg:none rejected.
- [ ] AC-3: `body.companyId` must equal JWT `sub`.
- [ ] AC-4: `claveAcceso` is the idempotency key.
- [ ] AC-5: State machine matrix is enforced via `canTransition`.
- [ ] AC-6: Stub mode works in dev; refuses to boot in production.
- [ ] AC-7: `/healthz` returns 200; integration smoke works in compose.

## 10. Definition of Done

- All boxes ticked; all integration tests green.
- Review file `ai/reviews/0020-sri-core-service-bootstrap-review.md` written.
