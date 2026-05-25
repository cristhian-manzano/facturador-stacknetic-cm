---
id: PLAN-0001
spec: SPEC-0001
title: Monorepo & workspace — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0001 — Monorepo & workspace

> Implementation plan for [SPEC-0001](../specs/0001-monorepo-and-workspace.md). Self-contained: an AI agent with no prior context can read this plan + the spec and execute it end-to-end.

## 1. Goal

Bootstrap the pnpm-based monorepo with the canonical workspace topology, TypeScript baseline configs, `.gitignore` hygiene, and naming conventions required by every downstream spec. After this slice:

- `pnpm install` at the root succeeds with zero warnings about workspace resolution.
- `pnpm -r build` walks every package and prints "no input files" or builds cleanly (no errors).
- The folder tree matches §6.1 of SPEC-0001 exactly.
- No secret-bearing files can be committed accidentally (`.gitignore` rules verified).

## 2. Inputs (read before starting)

- [SPEC-0001](../specs/0001-monorepo-and-workspace.md) — authoritative source.
- [ai/specs/0000-INDEX.md](../specs/0000-INDEX.md) — locked stack and naming.
- [ai/context/security.md](../context/security.md) — `.gitignore` "must never commit" list.
- [ai/context/product.md](../context/product.md) — workspace naming (`@facturador/*`).

## 3. Architecture decisions for this slice

| Decision                                                              | Rationale                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **pnpm workspaces** (no Lerna/Nx).                                    | Simpler, native, deterministic with `pnpm-lock.yaml`.                  |
| Apps under `apps/{web,api,sri-core}`.                                 | Three deployables; each has its own Dockerfile later.                  |
| Shared code in `packages/{contracts,config,utils,logger}`.            | Avoids cross-app relative imports; published-style packages.           |
| Strict TS at the root (`tsconfig.base.json`).                         | Every package extends it; one source of truth for compiler flags.      |
| `.nvmrc` pinned to **Node 22 LTS**.                                   | Matches Docker base image and CI runner.                               |
| ESM only (`"type": "module"` in every `package.json`).                | Modern Node, aligns with Vite/Express 5; avoids CJS/ESM interop traps. |
| Per-package `tsconfig.json` extends base and sets `outDir`/`rootDir`. | Allows independent build outputs and incremental tsc.                  |

## 4. Phases

### Phase 1 — Root scaffolding

1. Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`.
2. Create root `package.json` with `private: true`, `engines.node: ">=22 <23"`, `packageManager: "pnpm@9.x"`, and root scripts (`build`, `lint`, `test`, `typecheck`, `clean`).
3. Create `.nvmrc` containing `22`.
4. Create `tsconfig.base.json` with `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`.
5. Create `.gitignore` blocking: `node_modules`, `dist`, `coverage`, `.env*` (whitelisting `.env.example`), `*.p12`, `*.pfx`, `*.pem`, `*.key`, `*.crt`, `.DS_Store`, `*.log`, `.turbo`.
6. Create `.editorconfig` (LF, UTF-8, 2-space indent, final newline).

### Phase 2 — Apps scaffolding (empty but valid)

For each of `apps/web`, `apps/api`, `apps/sri-core`:

- `package.json` with name `@facturador/<app>`, `"private": true`, `"type": "module"`, scripts (`build`, `dev`, `lint`, `test`, `typecheck`).
- `tsconfig.json` extending `../../tsconfig.base.json`, `outDir: "dist"`, `rootDir: "src"`.
- `src/index.ts` placeholder (one line export so tsc has input).

### Phase 3 — Packages scaffolding (empty but valid)

For each of `packages/contracts`, `packages/config`, `packages/utils`, `packages/logger`:

- `package.json` with name `@facturador/<pkg>`, ESM, `main`/`types` pointing at `dist/index.js`/`dist/index.d.ts`, and an `exports` map ready for subpath exports (filled by SPEC-0005).
- `tsconfig.json` extending base, `composite: true` for project references.
- `src/index.ts` placeholder.

### Phase 4 — Verification

- `pnpm install` at root.
- `pnpm -r typecheck` (each package's `tsc --noEmit`).
- Smoke-commit a fake `secret.p12` and verify `git status` ignores it; delete the fake file before completing.

## 5. Risks & mitigations

| Risk                                           | Mitigation                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Wrong `moduleResolution` causes import errors. | Use `Bundler` at the base; downstream specs override if Node `NodeNext` is needed. |
| Workspace globs miss new packages.             | `apps/*` + `packages/*` covers all expected paths.                                 |
| Accidentally committing `.env` or certs.       | Phase 4 includes a manual smoke test of `.gitignore`.                              |
| Node version mismatch between contributors.    | `.nvmrc` + `engines.node` in root `package.json`.                                  |
| pnpm version drift.                            | Pin via `packageManager` field — Corepack honors it.                               |

## 6. Validation strategy

- **Build**: `pnpm -r build` returns exit 0.
- **Typecheck**: `pnpm -r typecheck` returns exit 0.
- **Lint**: deferred to SPEC-0002 (not in scope here).
- **Gitignore smoke**: create a temp `secret.p12`; `git status` must not list it.

## 7. Exit criteria

- All files in §6.1 of SPEC-0001 exist.
- Acceptance criteria AC-1…AC-7 of SPEC-0001 pass.
- `pnpm install`, `pnpm -r build`, `pnpm -r typecheck` all green.
- No secret-bearing globs visible to `git`.

## 8. Out of scope (deferred to other specs)

- ESLint / Prettier configuration → SPEC-0002.
- Docker / docker-compose → SPEC-0003.
- Prisma setup → SPEC-0004.
- Any business logic, contracts, runtime code → later specs.
