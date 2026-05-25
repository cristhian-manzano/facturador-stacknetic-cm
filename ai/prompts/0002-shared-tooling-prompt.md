---
id: PROMPT-0002
spec: SPEC-0002
plan: PLAN-0002
tasks: TASKS-0002
title: Execute TASKS-0002 — Shared tooling
---

# PROMPT-0002 — Execute shared tooling setup

You are an autonomous senior TypeScript / Node engineer specialised in monorepo developer experience. Your job is to execute **TASKS-0002** to completion: a shared ESLint flat config, Prettier, Lefthook, commitlint, and CI workflow file.

---

## 1. Mandatory reading (in order)

1. `ai/specs/0002-shared-tooling.md` — authoritative spec.
2. `ai/plans/0002-shared-tooling-plan.md` — phases and decisions.
3. `ai/tasks/0002-shared-tooling-tasks.md` — checklist you must execute.
4. `ai/specs/0001-monorepo-and-workspace.md` — prerequisite; the monorepo skeleton must already exist.
5. `ai/context/security.md` — drives the `no-process-env` rule and the rejection of `console.log`.
6. `ai/specs/0000-INDEX.md` — locked stack.

If files conflict: spec > plan > tasks > industry convention.

## 2. Scope guardrails

- ✅ Touch only files listed in TASKS-0002 (configs, `package.json` script entries, hook files, CI workflow).
- ❌ Do not introduce Vitest configuration (SPEC-0007's job).
- ❌ Do not modify runtime business code; this slice is tooling-only.
- ❌ Do not skip hooks (`--no-verify`) when committing — but this prompt does not ask you to commit at all.
- ❌ Never weaken a lint rule to make code pass; fix the code or document a justified file-level override.

## 3. Stack constraints

- ESLint 9 (flat config only).
- `typescript-eslint` v8+.
- Prettier 3.
- Lefthook (not Husky).
- `@commitlint/config-conventional`.
- All workspace members import the config through `@facturador/config/eslint`.

## 4. Code quality bar

- Plugin/config versions pinned in `package.json` (no `*`, no `latest`).
- Custom rules must include a clear `message` on `no-restricted-*` so violators see how to fix it.
- Per-file overrides must be the smallest possible scope (file glob, not whole directory) unless justified.

## 5. Validation requirement (the user's hard rule)

> "es indispensable que el codigo funcione, validando de alguna forma… no quiero bajo ninguna circunstancia implementaciones que no funcionen."

Concretely:

- `pnpm install` exits 0.
- `pnpm lint` exits 0 on a clean repo.
- Each forced-failure validation in TASKS §5 actually **fails** with a non-zero exit; you then **revert** the change so the repo ends clean.
- `pnpm format` is idempotent.
- The commit-msg hook actually rejects non-Conventional Commits (tested on a throwaway branch you delete).
- `actionlint` (or `@action-validator/cli`) lints the CI workflow clean.

If any of those does not hold, the task is **not done**.

## 6. Security considerations (verbatim from project policy)

- Never commit `.env`, `.p12`, `.pfx`, `.pem`, `.key`, `.crt`.
- Never log credentials in lint examples or test fixtures.
- The `no-process-env` rule is **load-bearing** — it forces all env access through a validated `src/env.ts` per SPEC-0006/0010. Do not soften it.

## 7. Deliverables

When TASKS-0002 is fully green, write a review at:

```
ai/reviews/0002-shared-tooling-review.md
```

The review file MUST include these headings:

1. **Summary** — 5–10 lines on what was wired.
2. **Files created / changed** — bulleted absolute paths.
3. **Validation evidence** — paste:
   - `eslint --version` output.
   - The result of each forced-failure scenario (TASKS §5.1–5.4): the failing exit code and the relevant rule name from the lint output.
   - `pnpm lint && pnpm format` clean-run output.
4. **Deviations from spec / plan** — anything you changed and why.
5. **Risks observed** — e.g., known plugin incompatibilities at the pinned versions, hook performance on large change-sets, etc.
6. **Security review** — explicitly confirm `no-console`, `no-process-env`, and `no-restricted-imports` are all `"error"`, not `"warn"`. List the file-level overrides and justify each.
7. **Suggested follow-ups** — out-of-scope items spotted during work (e.g., "consider Renovate config later", "add Vitest config in SPEC-0007").
8. **Sign-off checklist** — re-state SPEC-0002 acceptance criteria and tick each.

## 8. Communication style

- Reply succinctly in chat; the review is the durable record.
- Surface blockers right away; do not silently weaken constraints to keep moving.

## 9. Exit condition

You are done when:

- All boxes in TASKS-0002 are ticked.
- `pnpm lint && pnpm format && pnpm -r typecheck` are green.
- All four forced-failure validations were observed failing and then reverted.
- The review file exists, complete and signed off.

Begin.
