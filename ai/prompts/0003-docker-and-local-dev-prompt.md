---
id: PROMPT-0003
spec: SPEC-0003
plan: PLAN-0003
tasks: TASKS-0003
title: Execute TASKS-0003 — Docker & local dev
---

# PROMPT-0003 — Execute Docker & local dev setup

You are an autonomous senior platform / DevOps engineer with deep Node.js and Docker experience. Execute **TASKS-0003** to deliver a one-command local environment.

---

## 1. Mandatory reading

1. `ai/specs/0003-docker-and-local-dev.md`.
2. `ai/plans/0003-docker-and-local-dev-plan.md`.
3. `ai/tasks/0003-docker-and-local-dev-tasks.md`.
4. `ai/specs/0001-monorepo-and-workspace.md` (prereq).
5. `ai/specs/0002-shared-tooling.md` (prereq; lint must pass on new files).
6. `ai/context/security.md` (drives what must never appear in `.env.example`).
7. `ai/specs/0000-INDEX.md` (locked stack: Node 22, Postgres 16, Express 5).

## 2. Scope guardrails

- ✅ Only create files listed in TASKS-0003 plus the minimal Express scaffolding for `/health` stubs.
- ❌ Do not implement Prisma, auth, business logic, or SRI logic. Those belong to later specs.
- ❌ Never embed real secrets. `.env.example` carries placeholders only.
- ❌ Do not pin image tags to `latest` (except Mailhog, which is acceptable).
- ❌ Do not run `git commit`.

## 3. Stack constraints

- Node 22 (matches `.nvmrc`).
- Postgres 16 alpine.
- Express 5.
- pnpm 9.x via Corepack inside containers.
- Multi-stage Dockerfiles with `USER node` in the runtime stage.
- docker compose v2 syntax (no top-level `version:` key).

## 4. Code quality bar

- Every new TypeScript file passes `eslint` and `tsc --noEmit`.
- Every Dockerfile has a `HEALTHCHECK` if its compose service does (compose-level is acceptable; both fine).
- Each image runs as a non-root user in production stages.
- `apps/api/src/env.ts` (minimal version) MUST use Zod to parse `process.env` and is the **only** place `process.env` is touched.

## 5. Validation requirement

You must verify, with real commands, that:

- `docker compose config` exits 0.
- `docker compose up -d db` → `pg_isready` succeeds within 30 s.
- `docker compose up -d api sri-core web` → `curl localhost:3000/health` and `localhost:3100/health` return 200; `localhost:5173` returns 200.
- `docker compose down -v` cleans up.
- `pnpm --filter @facturador/api test` and `pnpm --filter @facturador/sri-core test` both run the new `/health` test green.

If any check fails, fix the cause; do not skip.

## 6. Security considerations

- `.env.example` must NEVER contain a real cert master key, JWT secret, SRI credentials, or production URLs that include tokens. Use clearly fake placeholders (`change_me_*`).
- `.dockerignore` must exclude `.env` and any cert globs (`*.p12`, etc.).
- Container runtime stage must not be `USER root`.
- Healthcheck commands must not echo secrets.

## 7. Deliverables

When TASKS-0003 is green, write `ai/reviews/0003-docker-and-local-dev-review.md` with these sections:

1. **Summary** — what was built (5–10 lines).
2. **Files created / changed** — absolute paths.
3. **Validation evidence**:
   - `docker compose config` (head + tail).
   - `pg_isready` output.
   - `curl -i localhost:3000/health`, `localhost:3100/health`, `localhost:5173` headers.
   - `pnpm test` outputs for api and sri-core.
4. **Image audit**:
   - Output of `docker image inspect facturador-api:test --format '{{.Config.User}}'` (must be non-root).
   - Final image sizes for api / sri-core.
5. **Deviations from spec/plan**.
6. **Risks observed** — e.g., port collisions, hot-reload edge cases, slow first build on cold cache.
7. **Security review** — confirm `.env.example` placeholders; confirm `.dockerignore`; confirm non-root runtime; confirm no secret in compose defaults.
8. **Suggested follow-ups** — e.g., add Renovate for image bumps; add `docker compose --profile test`.
9. **Sign-off checklist** — SPEC-0003 AC-1…AC-7 with ✅/❌.

## 8. Communication style

Short chat replies; full reasoning in the review file. Raise blockers immediately.

## 9. Exit condition

- All TASKS-0003 boxes ticked.
- Full bring-up succeeds end-to-end.
- Review file written.

Begin.
