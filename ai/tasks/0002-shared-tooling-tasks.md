---
id: TASKS-0002
spec: SPEC-0002
plan: PLAN-0002
title: Shared tooling — task checklist
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# TASKS-0002 — Shared tooling

> Granular checklist for [SPEC-0002](../specs/0002-shared-tooling.md) + [PLAN-0002](../plans/0002-shared-tooling-plan.md). Every task has a **mandatory validation step**.

## Hard rules

- ❌ A task is only "done" when its validation step runs and passes.
- ❌ Do not weaken a rule (e.g., changing `no-console: error` → `warn`) to make lint pass; fix the offending code instead.
- ✅ Forced-failure validations exist on purpose; they must produce a non-zero exit when triggered.

## 1. `@facturador/config` — ESLint flat config

- [ ] **1.1** Add devDependencies to `packages/config/package.json`:

  - `eslint@^9`
  - `@eslint/js`
  - `typescript-eslint@^8`
  - `eslint-plugin-import`
  - `eslint-plugin-unicorn`
  - `eslint-plugin-promise`
  - `eslint-plugin-n`
  - `eslint-plugin-unused-imports`
  - `eslint-config-prettier`
  - `prettier@^3`
  - `globals`
    **Validate**: `pnpm install` exits 0; `pnpm --filter @facturador/config exec eslint --version` prints `9.x`.

- [ ] **1.2** Create `packages/config/eslint.config.js` (the shared flat config). Must:

  - Apply to `**/*.{ts,tsx}` (default) and selectively to `**/*.{js,mjs,cjs}`.
  - Compose: `@eslint/js` recommended → `typescript-eslint.configs.strictTypeChecked` → `typescript-eslint.configs.stylisticTypeChecked` → plugins (import, unicorn, promise, n, unused-imports) → `eslint-config-prettier` LAST.
  - Set `languageOptions.parserOptions.project: true` and `ecmaVersion: 2022`, `sourceType: "module"`.
  - Custom rules:
    - `"no-console": "error"`
    - `"no-restricted-syntax": ["error", { selector: "MemberExpression[object.name='process'][property.name='env']", message: "Use packages/<pkg>/src/env.ts for env access." }]`
    - `"no-restricted-imports": ["error", { patterns: [{ group: ["../*/../*", "**/apps/*", "**/packages/*"], message: "Import via workspace package name, not relative paths." }] }]`
    - `"unused-imports/no-unused-imports": "error"`
    - `"import/no-default-export": "error"` (exception override: Vite/React files via separate config block).
  - File-level overrides:
    - `**/src/env.ts`: disable `no-restricted-syntax` for the `process.env` rule.
    - `**/*.test.ts`, `**/*.spec.ts`: allow `no-console: "off"`.
    - Vite config + React route files: allow default exports.
  - Ignore: `**/dist/**`, `**/node_modules/**`, `**/coverage/**`.
    **Validate**: `pnpm --filter @facturador/config exec eslint --print-config packages/config/eslint.config.js > /tmp/eslint-resolved.json` exits 0 and the file contains `"no-console"` set to `"error"`.

- [ ] **1.3** Update `packages/config/package.json` `exports` map to include `"./eslint"` pointing at `./eslint.config.js`.
      **Validate**: `node -e "console.log(require('@facturador/config/eslint'))"` (from repo root after `pnpm install`) prints a non-empty value.

## 2. Root Prettier + EditorConfig

- [ ] **2.1** Create root `.prettierrc.json`:

  ```json
  {
    "singleQuote": false,
    "semi": true,
    "trailingComma": "all",
    "printWidth": 100,
    "endOfLine": "lf"
  }
  ```

  **Validate**: `npx prettier --check ./package.json` exits 0 (or 1 if reformatting is needed — then run `--write` and re-check).

- [ ] **2.2** Create root `.prettierignore` listing `node_modules`, `dist`, `coverage`, `pnpm-lock.yaml`.
      **Validate**: `npx prettier --check pnpm-lock.yaml` exits 0 (file is ignored).

- [ ] **2.3** Confirm `.editorconfig` from SPEC-0001 exists; if not, create it.
      **Validate**: `test -f .editorconfig`.

## 3. Workspace consumption of ESLint

For each `apps/{web,api,sri-core}` and `packages/{contracts,utils,logger}`:

- [ ] **3.1.<dir>** Create `<dir>/eslint.config.js`:

  ```js
  export { default } from "@facturador/config/eslint";
  ```

  **Validate**: `pnpm --filter @facturador/<dir> exec eslint --print-config <dir>/eslint.config.js` exits 0.

- [ ] **3.2** Add to root `package.json` scripts: `"lint": "eslint .", "format": "prettier --write ."`.
      **Validate**: `pnpm lint` exits 0 (clean repo); `pnpm format` exits 0 and is idempotent (second run reports no changes).

## 4. Git hooks via Lefthook

- [ ] **4.1** Add devDependency at root: `lefthook` (latest).
      **Validate**: `pnpm exec lefthook version` prints a version.

- [ ] **4.2** Create `lefthook.yml`:

  ```yaml
  pre-commit:
    parallel: true
    commands:
      eslint:
        glob: "*.{ts,tsx,js,jsx}"
        run: pnpm eslint --fix {staged_files}
        stage_fixed: true
      prettier:
        glob: "*.{ts,tsx,js,jsx,json,md,yml,yaml}"
        run: pnpm prettier --write {staged_files}
        stage_fixed: true
  commit-msg:
    commands:
      commitlint:
        run: pnpm commitlint --edit {1}
  ```

  **Validate**: `pnpm exec lefthook install` exits 0; `.git/hooks/pre-commit` exists.

- [ ] **4.3** Add devDependencies: `@commitlint/cli`, `@commitlint/config-conventional`.
      **Validate**: `pnpm exec commitlint --version` prints version.

- [ ] **4.4** Create `commitlint.config.js`:
  ```js
  export default { extends: ["@commitlint/config-conventional"] };
  ```
  **Validate**: `echo "feat: test" | pnpm exec commitlint` exits 0; `echo "broken" | pnpm exec commitlint` exits non-zero.

## 5. Forced-failure validations (must trigger errors)

- [ ] **5.1** Temporarily add `console.log("hello")` to `packages/utils/src/index.ts`.
      **Validate**: `pnpm --filter @facturador/utils lint` exits with code 1 and mentions `no-console`. Revert change.

- [ ] **5.2** Temporarily add `const x = process.env.FOO;` to `packages/utils/src/index.ts`.
      **Validate**: `pnpm --filter @facturador/utils lint` exits 1 and mentions the `no-restricted-syntax` rule. Revert.

- [ ] **5.3** Temporarily add `import { x } from "../../apps/api/src/whatever";` to `packages/utils/src/index.ts`.
      **Validate**: `pnpm --filter @facturador/utils lint` exits 1 and mentions `no-restricted-imports`. Revert.

- [ ] **5.4** Forced bad commit (test on throwaway branch only, do **not** push):
  ```
  git checkout -b throwaway-lint-test
  git commit --allow-empty -m "bad message"
  ```
  **Validate**: hook rejects with non-zero exit; `git checkout -` and `git branch -D throwaway-lint-test`.

## 6. CI workflow file

- [ ] **6.1** Create `.github/workflows/ci.yml` with three jobs (lint, typecheck, test) running on `ubuntu-latest`, Node 22, using `pnpm/action-setup`. **Do not** add deploy steps.
      **Validate**: `npx -y @action-validator/cli@latest -e .github/workflows/ci.yml` (or `actionlint`) exits 0.

## 7. Acceptance criteria mapping

- [ ] AC-1: A single ESLint flat config is shared via `@facturador/config/eslint`.
- [ ] AC-2: `no-console`, `no-process-env`, cross-package import bans all fire as expected.
- [ ] AC-3: Prettier and ESLint do not fight over formatting rules.
- [ ] AC-4: Pre-commit hook reformats and lints staged files.
- [ ] AC-5: Commit-msg hook rejects non-Conventional-Commits.
- [ ] AC-6: `pnpm lint && pnpm format` is idempotent on a clean tree.
- [ ] AC-7: CI workflow file lints clean.

## 8. Definition of Done

- All tasks ticked, all forced-failure validations actually fail (and were reverted), all green checks pass.
- Review file `ai/reviews/0002-shared-tooling-review.md` written.
