---
id: SPEC-0001
title: Monorepo & workspace
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: []
blocks: [SPEC-0002, SPEC-0003, SPEC-0004, SPEC-0005]
---

# SPEC-0001 — Monorepo & workspace

## 1. Purpose

Establish the **physical layout** of the repository (folders, package manager, TypeScript configuration baseline) so every subsequent spec can place files in known, predictable locations. This is the foundation of every later spec.

## 2. Scope

### 2.1 In scope

- pnpm workspace setup.
- Folder layout for `apps/*` and `packages/*`.
- Root `package.json` with workspace-level scripts (build, lint, test, typecheck, dev).
- Base `tsconfig.base.json` shared across packages.
- Node.js version pinning (`.nvmrc` + `engines`).
- `.editorconfig`, `.gitignore`, `.gitattributes`.
- Conventional repository metadata: `README.md` skeleton, `LICENSE` placeholder.

### 2.2 Out of scope

- Linting/formatting rules (see [SPEC-0002](./0002-shared-tooling.md)).
- Docker images and compose files (see [SPEC-0003](./0003-docker-and-local-dev.md)).
- Database schema (see [SPEC-0004](./0004-database-and-prisma.md)).
- CI/CD pipelines (later spec).

## 3. Context & references

- [`ai/context/product.md`](../context/product.md) — three deployable services: Web, API, SRI Core.
- [`ai/context/security.md`](../context/security.md) — trust zones; SRI Core must be its own package/process.
- [`ai/context/glossary.md`](../context/glossary.md) — terminology.
- Prior monorepo attempt (now removed in git): see commit `eb30661` for inspiration only, not as binding.

## 4. Functional requirements

- **FR-1.** `pnpm install` at the repo root must install all workspace dependencies and link inter-package references via the `workspace:*` protocol.
- **FR-2.** Each app and each package owns its own `package.json`, `tsconfig.json`, and (when needed) `vitest.config.ts`.
- **FR-3.** A single root command runs every workspace's `build`, `lint`, `test`, `typecheck` script in dependency order. Use `pnpm -r` (recursive) or `pnpm --filter` as appropriate.
- **FR-4.** Repository must work on macOS, Linux, and Windows (WSL2). No symlinks outside `node_modules`.
- **FR-5.** Node version is pinned to a single LTS line and enforced in `engines` and `.nvmrc`.

## 5. Non-functional requirements

- **NFR-1.** Cold `pnpm install` on a developer laptop ≤ 90 s on cached registry.
- **NFR-2.** `pnpm -r build` of an empty (post-scaffold) tree ≤ 30 s.
- **NFR-3.** Layout must scale to ~30 packages without restructuring.
- **NFR-4.** No package may import from another package via a relative `../../packages/...` path. Always use the workspace alias (`@facturador/<name>`).

## 6. Technical design

### 6.1 Folder layout (final state of this spec)

```
.
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .nvmrc
├── LICENSE
├── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   ├── web/           # SPEC-0040
│   ├── api/           # SPEC-0030–0033
│   └── sri-core/      # SPEC-0020–0026
└── packages/
    ├── contracts/     # SPEC-0005
    ├── config/        # SPEC-0002 (eslint/prettier/ts shared configs)
    ├── utils/         # Generic helpers shared across apps
    └── logger/        # SPEC-0006
```

> Each child folder gets its **own spec** later. This spec only creates **empty** package skeletons (a `package.json`, `tsconfig.json`, `README.md`, and `src/index.ts` stub) so workspace resolution works.

### 6.2 Naming

- **Workspace scope:** `@facturador/<name>`. Examples: `@facturador/web`, `@facturador/api`, `@facturador/sri-core`, `@facturador/contracts`, `@facturador/utils`, `@facturador/config`, `@facturador/logger`.
- **Spanish in domain code, English in infrastructure code.** SRI terms (`claveAcceso`, `ambiente`, `secuencial`, etc.) stay verbatim. Generic engineering terms (`logger`, `request`, `tenant`) stay English. See [`ai/context/glossary.md`](../context/glossary.md).
- **File naming:** `kebab-case.ts` for files; `PascalCase` for React components; one symbol per file when possible.

### 6.3 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 6.4 Root `package.json` (template)

```jsonc
{
  "name": "facturador",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=22.0.0 <23",
    "pnpm": ">=9.0.0",
  },
  "scripts": {
    "build": "pnpm -r --parallel run build",
    "dev": "pnpm -r --parallel --stream run dev",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md,yml,yaml}\"",
    "clean": "pnpm -r exec rm -rf dist .turbo node_modules/.cache",
  },
  "devDependencies": {
    "prettier": "^3.3.3",
    "typescript": "^5.6.0",
  },
}
```

### 6.5 `tsconfig.base.json`

```jsonc
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"],
}
```

> Per-package `tsconfig.json` extends this and adds `compilerOptions.lib`, `jsx`, etc. as needed. Web extends with `"DOM"` and `"jsx": "react-jsx"`.

### 6.6 `.nvmrc`

```
22
```

### 6.7 `.gitignore` (canonical, do not deviate)

```
# Dependencies
node_modules/
.pnpm-store/

# Build
dist/
build/
*.tsbuildinfo

# Logs
logs/
*.log
pnpm-debug.log*
npm-debug.log*

# Env
.env
.env.*
!.env.example

# OS / Editor
.DS_Store
Thumbs.db
.idea/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json

# Test / coverage
coverage/
.vitest-cache/
playwright-report/
.playwright/

# Certificates / secrets (defense in depth — these MUST never be committed)
*.p12
*.pfx
*.pem
*.key
*.crt
secrets/

# Prisma
apps/api/prisma/migrations/dev.db*
```

### 6.8 `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### 6.9 `.gitattributes`

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.pdf binary
*.p12 binary
*.pfx binary
pnpm-lock.yaml linguist-generated=true
```

### 6.10 Stub package skeleton (apply to every `apps/*` and `packages/*` created in this spec)

`<pkg>/package.json`:

```jsonc
{
  "name": "@facturador/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
  },
}
```

`<pkg>/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
  },
  "include": ["src/**/*"],
}
```

`<pkg>/src/index.ts`:

```ts
export {};
```

`<pkg>/README.md`: one-paragraph description + link to its spec.

## 7. Implementation guide

### 7.1 Steps

1. Create `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, `.editorconfig` as per §6.
2. Create the directory tree from §6.1 with the stub package skeleton from §6.10 in every leaf.
3. `corepack enable && corepack prepare pnpm@9.12.0 --activate`.
4. `pnpm install` — must succeed with zero packages other than `prettier` and `typescript` from devDependencies.
5. `pnpm -r run typecheck` — must succeed (empty packages, type-checks trivially).
6. Commit the result on a feature branch named `spec/0001-monorepo-and-workspace`.

### 7.2 Dependencies to install

| Scope       | Package      | Version  | Purpose                              |
| ----------- | ------------ | -------- | ------------------------------------ |
| Root devDep | `typescript` | `^5.6.0` | Shared compiler.                     |
| Root devDep | `prettier`   | `^3.3.3` | Formatter (configured in SPEC-0002). |

No runtime dependencies in this spec.

### 7.3 Code conventions (apply across the repo)

- **Modules:** ESM only. No CommonJS.
- **Imports:** absolute via `@facturador/<name>` for cross-package, relative for intra-package, never reach into another package's `src/`.
- **Exports:** every package exposes its public surface from `src/index.ts`. No barrel files inside subfolders unless required for a clear API boundary.
- **Side effects:** packages must declare `"sideEffects": false` unless they truly need side effects (the only expected exception today is the web app).
- **Async:** prefer `async`/`await`; no `.then()` chains unless mandated by a third-party API.

## 8. Acceptance criteria

- **AC-1.** `pnpm install` succeeds from a clean clone, on Node 22, with no warnings other than transitive deprecation notices.
- **AC-2.** `pnpm -r run typecheck` succeeds.
- **AC-3.** `ls apps packages` shows exactly the seven children listed in §6.1.
- **AC-4.** Each leaf package has a `package.json`, `tsconfig.json`, `README.md`, and `src/index.ts`.
- **AC-5.** Importing one workspace package from another via `@facturador/<name>` resolves (smoke-test by adding `import "@facturador/utils";` in `apps/api/src/index.ts` and removing it before commit).
- **AC-6.** Repo contains no compiled output, no `node_modules`, no env files, no certificates.
- **AC-7.** `node --version` matches `.nvmrc` major version on the developer machine.

## 9. Test plan

- Manual: run steps 1–6 of §7.1 on a fresh clone in a temp dir.
- Automated (CI follow-up, not in this spec): a workflow that runs `pnpm install && pnpm -r typecheck` on PRs.

## 10. Security considerations

- `.gitignore` and `.gitattributes` block accidental commit of `.env*`, `.p12`, `.pfx`, `.pem`, `.key`, `.crt`. **Do not** weaken these rules in a future spec without an ADR.
- Pin pnpm version via `packageManager` to defeat lockfile drift from rogue local pnpm versions.

## 11. Observability

Not applicable at this stage.

## 12. Risks and mitigations

| Risk                                       | Mitigation                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Developers on different Node versions      | `.nvmrc` + `engines` + CI lint of `engines` (later spec).                                                         |
| Cross-package relative imports sneaking in | ESLint rule added in [SPEC-0002](./0002-shared-tooling.md): `no-restricted-imports` blocking `../../packages/**`. |
| pnpm version drift causing lockfile churn  | `packageManager` field in root `package.json` + Corepack.                                                         |

## 13. Open questions

- Do we need `turbo` or `nx` later? Not for this spec; revisit when the workspace reaches >10 packages or build time exceeds budget.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
