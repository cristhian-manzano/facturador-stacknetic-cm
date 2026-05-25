---
id: PROMPT-0001
spec: SPEC-0001
plan: PLAN-0001
tasks: TASKS-0001
title: Execute TASKS-0001 — Monorepo & workspace
---

# PROMPT-0001 — Execute monorepo & workspace bootstrap

You are an autonomous senior TypeScript / Node.js engineer. Your sole job in this session is to execute **TASKS-0001** end-to-end, producing a working pnpm monorepo skeleton for the facturador project.

---

## 1. Mandatory reading (in order, before touching any file)

Read these files in full. Do not skip:

1. `ai/specs/0001-monorepo-and-workspace.md` — the spec (the **what** and the precise **how**).
2. `ai/plans/0001-monorepo-and-workspace-plan.md` — the plan (phases, decisions, risks).
3. `ai/tasks/0001-monorepo-and-workspace-tasks.md` — the checklist you must execute.
4. `ai/specs/0000-INDEX.md` — locked stack and naming.
5. `ai/context/product.md` — workspace naming context.
6. `ai/context/security.md` — "must never commit" list (drives `.gitignore`).

If any of these files contradicts another, the spec wins. If the spec is silent, follow the plan; if both are silent, use industry best practice and document the decision in the review file.

## 2. Scope guardrails (hard limits)

- ✅ You may only create/modify files explicitly required by TASKS-0001.
- ❌ You may **not** introduce ESLint, Prettier, Docker, Prisma, or any runtime code — those are owned by later specs.
- ❌ You may **not** add dependencies beyond `typescript` (devDependency, latest 5.x) and what `pnpm install` itself needs.
- ❌ Never commit `.env`, `.p12`, `.pfx`, `.pem`, `.key`, `.crt`, or any real credentials. If you create temp files for `.gitignore` smoke tests, delete them before finishing.
- ❌ Never run `git add -A` or `git commit` unless the user explicitly asks; this prompt does **not** ask.

## 3. Stack constraints (non-negotiable)

- pnpm workspaces (no Lerna, no Nx, no Turborepo).
- Node 22 LTS pinned via `.nvmrc` and `engines.node`.
- TypeScript 5.x strict mode, ESM only (`"type": "module"`).
- No build orchestrator beyond `pnpm -r <cmd>` for now.

## 4. Execution rules

1. Walk TASKS-0001 top-to-bottom. For each task:
   a. Implement.
   b. Run the **Validate** step exactly as written.
   c. If validation fails, fix the root cause. Never weaken or skip a validation.
   d. Tick the box only after validation passes.
2. Tasks within a section may run in parallel only if their validations are independent.
3. If you discover a real defect in the spec or plan (not a misunderstanding), pause, document it in the review file, and continue with the most defensible interpretation.

## 5. Code quality bar

- Every JSON file must be valid JSON (no trailing commas, no comments in `package.json`).
- Every TS placeholder must compile under `strict: true` + `noUncheckedIndexedAccess`.
- Filenames are kebab-case; package names are `@facturador/<kebab>`.
- No `console.log`, no `// TODO` without a tracked task ID.
- Indentation: 2 spaces, LF line endings, final newline.

## 6. Validation requirement (the user's hard rule)

> "es indispensable que el codigo funcione, validando de alguna forma, ya sea corriendo codigo, si es api ejecutando endpoint, o usando test unitarios. no quiero bajo ninguna circunstancia implementaciones que no funcionen."

Concretely for this task:

- `pnpm install` must exit 0 from a clean state.
- `pnpm -r typecheck` must exit 0.
- `pnpm -r build` must exit 0 and produce a `dist/` per package/app.
- `.gitignore` smoke tests in TASKS §4.4 and §4.5 must show the files as ignored.

If any of those fails, the task is **not done**.

## 7. Deliverables

When TASKS-0001 is fully green, produce a review file at:

```
ai/reviews/0001-monorepo-and-workspace-review.md
```

The review file MUST contain (use these exact headings):

1. **Summary** — What was built, in 5–10 lines.
2. **Files created / changed** — Bulleted list with absolute paths.
3. **Validation evidence** — Paste the commands you ran and the relevant tail of their output (truncate `pnpm install` chatter, but show "Done", "0 errors", or equivalent).
4. **Deviations from spec / plan** — Anything you had to do differently and why.
5. **Risks observed** — Anything fragile, anything a follow-up spec must address (e.g., "no project references yet — SPEC-0005 will need to add them").
6. **Security review** — Confirm no secret-bearing files exist in the working tree. List every glob in `.gitignore` and assert each is intentional.
7. **Suggested follow-ups** — Items that are out of scope here but should be tracked.
8. **Sign-off checklist** — Re-state each SPEC-0001 acceptance criterion (AC-1…AC-7) and mark ✅ / ❌ with a one-line justification.

## 8. Communication style

- Be concise in chat — the review file is where the long-form explanation lives.
- Surface blockers immediately; do not invent workarounds for missing information.
- If you have to make a judgement call, log it in the review file under "Deviations".

## 9. Exit condition

You are done when:

- All boxes in TASKS-0001 are ticked.
- The review file at `ai/reviews/0001-monorepo-and-workspace-review.md` is written and complete.
- The working tree contains no untracked secret-bearing files.

Begin.
