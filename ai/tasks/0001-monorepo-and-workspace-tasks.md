---
id: TASKS-0001
spec: SPEC-0001
plan: PLAN-0001
title: Monorepo & workspace — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0001 — Monorepo & workspace

> Granular checklist derived from [SPEC-0001](../specs/0001-monorepo-and-workspace.md) and [PLAN-0001](../plans/0001-monorepo-and-workspace-plan.md). Every task ends with a **mandatory validation step**. Do **not** mark a task done if its validation does not pass.

## Hard rules (apply to every task)

- ❌ No task may be marked done without executing its validation step and confirming exit code 0 (or the documented expected output).
- ❌ No implementation may be "stub but not wired"; if a step says `pnpm install` must succeed, it must actually succeed.
- ✅ If a validation fails, fix the cause; do not weaken the validation.

## 1. Root scaffolding

- [ ] **1.1** Create `pnpm-workspace.yaml` with:

  ```yaml
  packages:
    - "apps/*"
    - "packages/*"
  ```

  **Validate**: `cat pnpm-workspace.yaml` shows both globs.

- [ ] **1.2** Create root `package.json` with:

  - `"private": true`
  - `"name": "facturador-stacknetic-cm"`
  - `"type": "module"`
  - `"engines": { "node": ">=22 <23" }`
  - `"packageManager": "pnpm@9.15.0"` (or latest 9.x at time of execution; pin exact version)
  - `"scripts"`: `build`, `lint`, `test`, `typecheck`, `clean` — each running `pnpm -r <cmd>`.
    **Validate**: `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` exits 0.

- [ ] **1.3** Create `.nvmrc` containing exactly `22`.
      **Validate**: `test "$(cat .nvmrc)" = "22"`.

- [ ] **1.4** Create `tsconfig.base.json` with these compiler options minimum:

  - `"target": "ES2022"`
  - `"module": "ESNext"`
  - `"moduleResolution": "Bundler"`
  - `"strict": true`
  - `"noUncheckedIndexedAccess": true`
  - `"exactOptionalPropertyTypes": true`
  - `"verbatimModuleSyntax": true`
  - `"esModuleInterop": true`
  - `"skipLibCheck": true`
  - `"resolveJsonModule": true`
  - `"isolatedModules": true`
  - `"forceConsistentCasingInFileNames": true`
    **Validate**: `npx -y tsc -p tsconfig.base.json --showConfig` parses and prints resolved options.

- [ ] **1.5** Create `.gitignore` with at minimum:

  ```
  node_modules
  dist
  coverage
  .env
  .env.*
  !.env.example
  *.p12
  *.pfx
  *.pem
  *.key
  *.crt
  *.log
  .DS_Store
  .turbo
  .vscode/
  !.vscode/extensions.json
  ```

  **Validate**: `git check-ignore -v fake.p12 .env .env.production` prints `.gitignore:<n>:<rule>` for each.

- [ ] **1.6** Create `.editorconfig` enforcing LF, UTF-8, 2 spaces, trim trailing whitespace, final newline.
      **Validate**: `head -1 .editorconfig` shows `root = true`.

## 2. Apps scaffolding

Repeat for each app in `["web","api","sri-core"]`:

- [ ] **2.1.<app>** Create `apps/<app>/package.json` with:

  - `"name": "@facturador/<app>"`
  - `"private": true`
  - `"type": "module"`
  - `"version": "0.0.0"`
  - `"scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "lint": "eslint .", "test": "vitest run" }`
    **Validate**: `node -e "JSON.parse(require('fs').readFileSync('apps/<app>/package.json'))"` exits 0.

- [ ] **2.2.<app>** Create `apps/<app>/tsconfig.json` extending `../../tsconfig.base.json` with `"outDir": "dist"`, `"rootDir": "src"`, `"include": ["src/**/*"]`.
      **Validate**: `npx tsc -p apps/<app>/tsconfig.json --noEmit` returns exit 0 (must succeed even with only the placeholder file).

- [ ] **2.3.<app>** Create `apps/<app>/src/index.ts` containing `export const placeholder = "${app}";`.
      **Validate**: file exists and is non-empty.

## 3. Packages scaffolding

Repeat for each package in `["contracts","config","utils","logger"]`:

- [ ] **3.1.<pkg>** Create `packages/<pkg>/package.json` with:

  - `"name": "@facturador/<pkg>"`
  - `"private": true`
  - `"type": "module"`
  - `"version": "0.0.0"`
  - `"main": "./dist/index.js"`
  - `"types": "./dist/index.d.ts"`
  - `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`
  - `"scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" }`
    **Validate**: JSON parses.

- [ ] **3.2.<pkg>** Create `packages/<pkg>/tsconfig.json` extending base, `"composite": true`, `"declaration": true`, `"outDir": "dist"`, `"rootDir": "src"`.
      **Validate**: `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` exits 0.

- [ ] **3.3.<pkg>** Create `packages/<pkg>/src/index.ts` with `export const placeholder = "${pkg}";`.
      **Validate**: file non-empty.

## 4. Install & end-to-end verification

- [ ] **4.1** Run `pnpm install` at repo root.
      **Validate**: exit code 0; `node_modules/.pnpm` directory exists; `pnpm-lock.yaml` was created.

- [ ] **4.2** Run `pnpm -r typecheck`.
      **Validate**: exit code 0; output mentions each `@facturador/*` package without errors.

- [ ] **4.3** Run `pnpm -r build`.
      **Validate**: exit code 0; each app/package has a `dist/index.js` after the build.

- [ ] **4.4** **Gitignore smoke test**: create a temp file `tmp.p12` at repo root.
      **Validate**: `git status --porcelain tmp.p12` returns empty; **then delete `tmp.p12`**.

- [ ] **4.5** **Gitignore smoke test 2**: create `.env`.
      **Validate**: `git status --porcelain .env` is empty; delete `.env`.

## 5. Acceptance criteria mapping

Tick once §4 passes and each SPEC-0001 acceptance criterion has been independently confirmed:

- [ ] AC-1: Workspace globs resolve to apps + packages.
- [ ] AC-2: TS base config is consumed by every sub-project.
- [ ] AC-3: `pnpm install` produces a lockfile.
- [ ] AC-4: `pnpm -r typecheck` passes on empty placeholders.
- [ ] AC-5: `.gitignore` rejects `.env*` and cert globs.
- [ ] AC-6: `.nvmrc` matches Docker base image (22).
- [ ] AC-7: Naming convention `@facturador/*` followed for every workspace member.

## 6. Definition of Done

- All tasks above checked.
- `pnpm install && pnpm -r typecheck && pnpm -r build` is green from a clean clone.
- No secret files were committed; `.gitignore` smoke tests passed.
- Review file `ai/reviews/0001-monorepo-and-workspace-review.md` written (see prompt for required sections).
