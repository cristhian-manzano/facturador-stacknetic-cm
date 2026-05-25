---
id: PLAN-0002
spec: SPEC-0002
title: Shared tooling — implementation plan
status: ready
owner: TBD
created: 2026-05-19
updated: 2026-05-19
---

# PLAN-0002 — Shared tooling

> Implementation plan for [SPEC-0002](../specs/0002-shared-tooling.md). Builds on [PLAN-0001](./0001-monorepo-and-workspace-plan.md).

## 1. Goal

Wire deterministic code quality across the monorepo: a single ESLint 9 flat-config consumed by every workspace, Prettier, EditorConfig consistency, conventional commits + commit hooks, and an enforced ban on `console.log`, cross-package relative imports, and raw `process.env` access outside `src/env.ts`.

After this slice:

- `pnpm lint` and `pnpm format` work at root and in every package.
- A pre-commit hook runs lint-staged + format on staged files.
- A commit-msg hook enforces Conventional Commits.
- `eslint .` returns 0 with the canonical placeholder files in place.

## 2. Inputs

- [SPEC-0002](../specs/0002-shared-tooling.md) — authoritative.
- [SPEC-0001](../specs/0001-monorepo-and-workspace.md) — prerequisite scaffolding must exist.
- [ai/context/security.md](../context/security.md) — drives the `no-process-env` rule.

## 3. Architecture decisions

| Decision                                                                                                                                                  | Rationale                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ESLint **flat config** (`eslint.config.js`) in `@facturador/config`.                                                                                      | Future-proof; ESLint 9 is flat-only. One source of truth re-exported by every app/package. |
| `@typescript-eslint` recommended + strict + stylistic.                                                                                                    | Catches real bugs and enforces stylistic norms without bikeshedding.                       |
| Custom rule layer: `no-console` (error), `no-restricted-imports` (block cross-package relative paths), `no-process-env` (forbidden outside `src/env.ts`). | These map directly to security/maintainability invariants.                                 |
| Prettier (latest) with shared `.prettierrc.json` at root; ESLint defers formatting to Prettier (`eslint-config-prettier`).                                | Avoids ESLint↔Prettier conflicts.                                                         |
| Lefthook for git hooks (not Husky).                                                                                                                       | Faster, single binary, no `prepare` script needed; CI-friendly.                            |
| Commitlint with `@commitlint/config-conventional`.                                                                                                        | Mechanical PR-title and release-notes hygiene.                                             |
| lint-staged equivalent via Lefthook globs.                                                                                                                | Only touches staged files; sub-second hook runtime.                                        |

## 4. Phases

### Phase 1 — `@facturador/config` package fills out

1. Add `eslint.config.js` exporting the flat config array. Include:
   - `@eslint/js` recommended
   - `typescript-eslint` strict-type-checked + stylistic-type-checked
   - `eslint-plugin-import`
   - `eslint-plugin-unicorn` (curated subset)
   - `eslint-plugin-promise`
   - `eslint-plugin-n` (Node)
   - `eslint-config-prettier` (last)
2. Add custom rules:
   - `no-console: error` (warn for `apps/web/**/*.test.*` only via override).
   - `no-restricted-imports`: deny `../../**` patterns that cross workspace roots.
   - `no-restricted-syntax`: deny `MemberExpression[object.name="process"][property.name="env"]` outside `**/src/env.ts`.
   - `unused-imports/no-unused-imports: error`.
3. Add `.prettierrc.json` (root): `singleQuote: false`, `semi: true`, `trailingComma: "all"`, `printWidth: 100`.
4. Export `prettier` config object too if downstream packages need to compose.

### Phase 2 — Workspace consumption

For each app and package, add a tiny `eslint.config.js` that re-exports `@facturador/config/eslint`:

```js
export { default } from "@facturador/config/eslint";
```

And add `"lint": "eslint ."` to its `package.json` scripts (if not already there).

### Phase 3 — Hooks

1. Add `lefthook.yml` at root with:
   - `pre-commit`: run `eslint --fix` and `prettier --write` on staged JS/TS/JSON/MD files.
   - `commit-msg`: run `commitlint --edit $1`.
2. Add `commitlint.config.js` extending `@commitlint/config-conventional`.
3. Run `pnpm dlx lefthook install` once and verify hooks register.

### Phase 4 — CI shape (file only, no pipeline yet)

Add `.github/workflows/ci.yml` placeholder with three jobs (`lint`, `typecheck`, `test`) reading from a single matrix. **Do not** wire it to deploy — that is a separate spec.

### Phase 5 — Verification

- `pnpm lint` at root passes.
- Forced violation tests: temporarily add `console.log("x")` to one placeholder, run `pnpm lint`, see it fail. Revert.
- Forced bad commit message (`git commit -m "blah"`) is rejected by the commit-msg hook on a throwaway branch (do not push). Reset.

## 5. Risks & mitigations

| Risk                                                                                | Mitigation                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ESLint flat-config plugin compatibility gaps.                                       | Pin all plugin versions; lock to versions known to support flat config (typescript-eslint v8+). |
| Cross-package `no-restricted-imports` rule misfires inside `node_modules` symlinks. | Use the `ignores` field at the top of the flat config for `**/node_modules/**`.                 |
| Hooks slow down commits.                                                            | Lefthook + only staged files; budget < 3 s on the local machine.                                |
| Prettier vs ESLint formatting fight.                                                | `eslint-config-prettier` last in chain disables formatting rules.                               |

## 6. Validation strategy

- `pnpm lint` exits 0 on a clean repo.
- A deliberate `console.log` triggers a lint error.
- A deliberate `process.env.FOO` outside `src/env.ts` triggers a lint error.
- A non-conventional commit message is rejected.
- `pnpm format` reformats sample files deterministically (idempotent: second run is a no-op).

## 7. Exit criteria

- All SPEC-0002 acceptance criteria pass.
- Hooks installed and verified locally.
- CI workflow file present (even if not yet running on GitHub).

## 8. Out of scope

- Vitest configuration → SPEC-0007.
- CI deployment / publish steps → later.
- Renovate / Dependabot → later.
