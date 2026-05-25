---
id: SPEC-0002
title: Shared tooling — ESLint, Prettier, conventions, hooks
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001]
blocks: [SPEC-0003, SPEC-0004, SPEC-0010, SPEC-0040]
---

# SPEC-0002 — Shared tooling

## 1. Purpose

Standardise developer tooling across the workspace so every package builds, lints, formats, and runs tests identically. Goal: zero per-package divergence; a contributor edits any package the same way.

## 2. Scope

### 2.1 In scope

- ESLint 9 flat config with `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-react` (web only), `eslint-plugin-unicorn` (subset), `eslint-plugin-security` (subset).
- Prettier 3 with shared config.
- Vitest configuration baseline.
- Pre-commit hook via `lefthook` running lint+format on staged files.
- Conventional commits via commit-msg hook.
- Editor config (`.vscode/settings.json`, `.vscode/extensions.json` recommendations).
- Reusable shared config package: `@facturador/config`.

### 2.2 Out of scope

- Per-app eslint overrides (each app's spec adds its own minimal overrides).
- Type-checking strategy (already locked in [SPEC-0001](./0001-monorepo-and-workspace.md)).
- CI workflows (later spec).

## 3. Context & references

- [SPEC-0001](./0001-monorepo-and-workspace.md) — workspace and tsconfig baseline.
- [`ai/context/security.md`](../context/security.md) — informs lint rules around logging and secrets.
- ESLint flat config docs: https://eslint.org/docs/latest/use/configure/configuration-files
- typescript-eslint v8: https://typescript-eslint.io/

## 4. Functional requirements

- **FR-1.** A single `@facturador/config` package exports `eslint.base.js`, `eslint.node.js`, `eslint.react.js`, and `prettier.config.cjs`.
- **FR-2.** Every workspace (`apps/*`, `packages/*`) consumes the shared config with at most ~10 lines in its own `eslint.config.js`.
- **FR-3.** `pnpm lint` from root runs ESLint over all workspaces with zero errors on a freshly scaffolded repo.
- **FR-4.** `pnpm format` (Prettier) is idempotent on a freshly scaffolded repo.
- **FR-5.** A pre-commit hook runs `eslint --fix` and `prettier --write` only on staged files (no full-repo lint).
- **FR-6.** A commit-msg hook enforces Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:`).
- **FR-7.** Lint rules **forbid**:
  - Cross-package relative imports (`../../packages/**`, `../../apps/**`).
  - `console.log` in production code (`packages/*/src/**`, `apps/*/src/**`) — must use the logger from `@facturador/logger`.
  - `any` (except in test files).
  - Importing `crypto.createHash('md5')` and other weak primitives.
  - `process.env.X` access outside `apps/*/src/env.ts` (forces centralised env validation).

## 5. Non-functional requirements

- **NFR-1.** `pnpm lint` on the full empty workspace ≤ 10 s.
- **NFR-2.** Pre-commit hook on a 5-file change ≤ 3 s.
- **NFR-3.** Config exports are typed (TypeScript-checked) where possible.

## 6. Technical design

### 6.1 `packages/config/` layout

```
packages/config/
├── package.json
├── README.md
├── eslint.base.js          # Shared TS/Node rules
├── eslint.node.js          # base + node-globals + no-floating-promises
├── eslint.react.js         # base + react + react-hooks + jsx-a11y
├── prettier.config.cjs
└── vitest.base.ts
```

### 6.2 `packages/config/package.json`

```jsonc
{
  "name": "@facturador/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./eslint.base": "./eslint.base.js",
    "./eslint.node": "./eslint.node.js",
    "./eslint.react": "./eslint.react.js",
    "./prettier": "./prettier.config.cjs",
    "./vitest.base": "./vitest.base.ts",
  },
  "peerDependencies": {
    "eslint": "^9.10.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
  },
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.6.0",
    "@typescript-eslint/parser": "^8.6.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.30.0",
    "eslint-plugin-security": "^3.0.1",
    "eslint-plugin-unicorn": "^55.0.0",
    "globals": "^15.9.0",
  },
}
```

The React config additionally pulls `eslint-plugin-react@^7.36.0`, `eslint-plugin-react-hooks@^4.6.2`, `eslint-plugin-jsx-a11y@^6.10.0`.

### 6.3 `eslint.base.js` (excerpt — rules that must be in)

```js
// eslint.base.js
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import security from "eslint-plugin-security";
import unicorn from "eslint-plugin-unicorn";
import prettier from "eslint-config-prettier";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: true, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin, import: importPlugin, security, unicorn },
    rules: {
      // TS
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Import hygiene
      "import/no-default-export": "error", // named exports preferred
      "import/no-cycle": ["error", { maxDepth: 1 }],
      "import/order": ["error", { "newlines-between": "always", alphabetize: { order: "asc" } }],
      // Forbid console.log in production code
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Security
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-child-process": "error",
      // Unicorn (subset)
      "unicorn/no-null": "off",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-string-replace-all": "error",
      // Misc
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      "import/no-default-export": "off",
    },
  },
  prettier,
];
```

### 6.4 `eslint.node.js` (excerpt)

```js
import base from "./eslint.base.js";
import globals from "globals";

export default [
  ...base,
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: { globals: globals.node },
    rules: {
      // Forbid raw process.env access except in dedicated env files
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Access env via env.ts (zod-validated)." },
      ],
    },
  },
  {
    files: ["**/src/env.ts", "**/src/env/index.ts"],
    rules: { "no-restricted-properties": "off" },
  },
];
```

### 6.5 `eslint.react.js` (excerpt)

```js
import base from "./eslint.base.js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.es2023 } },
    plugins: { react, "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-is-valid": "error",
    },
  },
];
```

### 6.6 Per-package consumption

`apps/api/eslint.config.js`:

```js
import node from "@facturador/config/eslint.node";
export default node;
```

`apps/web/eslint.config.js`:

```js
import react from "@facturador/config/eslint.react";
export default react;
```

`packages/contracts/eslint.config.js`:

```js
import node from "@facturador/config/eslint.node";
export default node;
```

### 6.7 Prettier — `packages/config/prettier.config.cjs`

```js
/** @type {import("prettier").Config} */
module.exports = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  singleQuote: false,
  trailingComma: "all",
  semi: true,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
};
```

Root `prettier.config.cjs`:

```js
module.exports = require("@facturador/config/prettier");
```

### 6.8 Vitest base — `packages/config/vitest.base.ts`

```ts
import { defineConfig } from "vitest/config";

export const baseConfig = defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
    reporters: ["default"],
  },
});
```

### 6.9 Pre-commit and commit-msg hooks (`lefthook.yml`)

```yaml
# lefthook.yml at repo root
pre-commit:
  parallel: true
  commands:
    eslint:
      glob: "*.{ts,tsx,js,jsx}"
      run: pnpm exec eslint --fix --max-warnings 0 {staged_files}
      stage_fixed: true
    prettier:
      glob: "*.{ts,tsx,js,jsx,json,md,yml,yaml}"
      run: pnpm exec prettier --write {staged_files}
      stage_fixed: true

commit-msg:
  commands:
    conventional:
      run: |
        if ! grep -qE '^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\(.+\))?!?: .+' "$1"; then
          echo "Commit message must follow Conventional Commits."; exit 1
        fi
```

Add `lefthook` as a root devDependency. Installed via `pnpm exec lefthook install` (script in root `package.json`'s `prepare`).

### 6.10 VSCode workspace defaults

`.vscode/settings.json`:

```jsonc
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.eol": "\n",
}
```

`.vscode/extensions.json`:

```jsonc
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "Prisma.prisma",
    "bradlc.vscode-tailwindcss",
  ],
}
```

## 7. Implementation guide

### 7.1 Steps

1. Create the `packages/config/` files from §6.1–6.8.
2. Add `lefthook.yml` at root and add `"prepare": "lefthook install"` to root `package.json`.
3. Install the dev tools at root (lefthook) and at `@facturador/config` (eslint + plugins per §6.2).
4. In every existing workspace, add `eslint.config.js` consuming the shared config (§6.6).
5. Add `.vscode/` files per §6.10.
6. Run `pnpm install`, then `pnpm lint`, then `pnpm format`. Must all pass cleanly.
7. Commit on `spec/0002-shared-tooling`.

### 7.2 Dependencies to install (root)

| Package    | Version   | Purpose            |
| ---------- | --------- | ------------------ |
| `lefthook` | `^1.7.0`  | Git hooks manager. |
| `eslint`   | `^9.10.0` | Linter.            |

(Plugins live as dependencies of `@facturador/config`.)

### 7.3 Code conventions enforced from this spec onward

- All TypeScript files are ESM.
- Named exports only (except framework-required defaults like `vite.config.ts`).
- Imports ordered: builtin → external → internal `@facturador/...` → relative.
- No `console.log` in production code — use `@facturador/logger` ([SPEC-0006](./0006-error-model-and-logging.md)).
- No raw `process.env.X` access outside `src/env.ts`.

## 8. Acceptance criteria

- **AC-1.** `pnpm lint` exits with code 0 on a fresh scaffold.
- **AC-2.** Adding `console.log("hi")` to `apps/api/src/index.ts` makes `pnpm lint` fail.
- **AC-3.** Adding `import "../../packages/utils/src/foo";` to a file makes `pnpm lint` fail.
- **AC-4.** `git commit -m "wip"` is rejected by the commit-msg hook; `git commit -m "feat: add x"` is accepted.
- **AC-5.** `pnpm format` is idempotent (running it twice produces no changes).
- **AC-6.** A staged file with mixed quotes is auto-fixed on `git commit`.
- **AC-7.** `pnpm exec eslint --print-config apps/api/src/index.ts` shows the merged config — sanity check that consumption works.

## 9. Test plan

- Run each of AC-1 through AC-7 manually in a fresh clone.
- Future CI workflow runs `pnpm lint && pnpm format --check`.

## 10. Security considerations

- `eslint-plugin-security` rules enabled defensively (see §6.3). They flag suspicious patterns; they're not a substitute for design.
- Pre-commit hooks must **never** auto-stage files matched by `.gitignore` (lefthook respects gitignore by default — verify).
- The commit-msg hook must not log the commit body (no PII leak risk, but keep the discipline).

## 11. Observability

Not applicable.

## 12. Risks and mitigations

| Risk                                                        | Mitigation                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Lint rules become noisy and developers disable them locally | Keep the rule set lean — every rule must justify itself. Quarterly review. |
| Hook performance degrades as repo grows                     | Hook runs only on staged files. Full-repo lint moves to CI.                |
| Conflict between Prettier and ESLint stylistic rules        | `eslint-config-prettier` last in the chain — already configured.           |

## 13. Open questions

- Switch to `biome` later? Not now. Biome's TS-aware rule coverage isn't at parity with typescript-eslint for our needs.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
