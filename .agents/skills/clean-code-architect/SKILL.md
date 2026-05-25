---
name: clean-code-architect
description: Apply modern software engineering principles — Clean Code, Clean Architecture (when it fits), SOLID, KISS, YAGNI, DRY, Separation of Concerns, high cohesion / low coupling, dependency inversion, composition over inheritance — whenever the user asks to generate, write, create, review, refactor, reorganize, restructure, clean up, modernize, modularize, split, simplify, improve, optimize, or evaluate code, components, modules, services, classes, functions, folders, or architecture. Use this skill proactively for any non-trivial code work in serious, production, scalable, maintainable or collaborative projects, even when the user does not explicitly mention "clean code", "architecture" or "quality" — for example "add this feature", "help me build X", "this file is getting messy", "organize this folder", "fix this function", "can you make this better", "extract this logic", "is this well designed?". The skill produces readable, modular, testable, predictable, boring-in-the-good-way code that is easy for both humans and AI agents to navigate, modify and extend, while deliberately avoiding over-engineering, premature abstraction and premature optimization.
---

# Clean Code Architect

A skill for producing and reviewing code that is **simple, readable, modular, testable, scalable and easy to maintain** — for both humans and AI agents — without falling into over-engineering.

The goal is not to recite principles, but to use them as tools to make real code better. Default to **boring, explicit, predictable** solutions. Reach for patterns and abstractions only when they pay for themselves in clarity or extensibility.

---

## When to use this skill

Activate whenever the user asks to:

- **Generate / write / create** new code, features, modules, components, services, endpoints.
- **Review** existing code, a PR, a file, a folder, or an architectural decision.
- **Refactor / restructure / reorganize / clean up / simplify / modernize** code.
- **Split** large files, classes, components, functions, or modules.
- **Improve** readability, performance, testability, maintainability, or design.
- **Evaluate** code quality, cohesion, coupling, separation of concerns.
- **Organize** folders, architectural boundaries, layers, feature modules.

Use it even when the user does not explicitly mention "clean code", "quality", "architecture" or "SOLID" — if the task is non-trivial code work in a project that benefits from being maintainable, this skill should guide the response.

**Skip it for:**

- Trivial one-line edits (typos, log additions, tiny doc fixes).
- Purely informational questions (e.g. "what does `map` do?").
- Prototypes / throwaway scripts where the user explicitly says "quick and dirty".

---

## Core principles (apply by default)

Apply these as a **mental checklist**, not as commandments. They compete with each other — use judgment.

### Readability and simplicity

- **Clean Code**: clear names, short functions, minimal nesting, low cognitive load.
- **KISS**: pick the simplest solution that solves the real problem.
- **YAGNI**: do not build for hypothetical future needs.
- **Explicit is better than implicit**: avoid magic, hidden side effects, implicit globals.
- **Principle of Least Astonishment**: names, signatures and behavior should match expectations.
- **Convention over configuration** when a sensible default exists.

### Design and structure

- **SOLID** as a lens, not dogma:
  - **SRP**: one reason to change per module/function.
  - **OCP**: extend without modifying, when variation is real and recurring.
  - **LSP**: subtypes honor contracts.
  - **ISP**: small, focused interfaces.
  - **DIP**: depend on abstractions at boundaries that change independently.
- **Separation of Concerns**: separate business logic, infrastructure, presentation, validation, configuration and data access.
- **High cohesion, low coupling**.
- **Composition over inheritance**.
- **Dependency Injection** when it improves testability or decoupling.
- **Fail fast**: validate inputs at boundaries and raise clear errors early.
- **DRY**, but only after duplication is proven and stable — prefer three similar lines to a premature abstraction.

### Architecture (when the project warrants it)

Use Clean / Hexagonal / Ports & Adapters / Feature-based / DDD / CQRS **only** when the domain or scale justifies it. For small modules, a flat, obvious structure is better.

---

## Mandatory practices when writing or modifying code

- Functions **short, focused, with a single responsibility** when it helps.
- Avoid files/classes/components/modules that are **too large**; split by responsibility when they stop fitting in one mental model.
- Put each responsibility in the **right layer** (domain, application, infrastructure, UI, config).
- Avoid unnecessary duplication **and** avoid unnecessary abstraction.
- Use **clear, expressive, consistent names** that reveal intent.
- Use **types, interfaces and contracts** whenever the language supports them.
- Keep **APIs internal surface small and predictable**.
- Handle errors **explicitly and consistently**; never swallow them silently.
- Keep code **deterministic and easy to mock**; isolate side effects.
- Prefer **early returns and guard clauses** over deeply nested conditionals.
- Avoid functions with **too many parameters** — group related args into an object / value type.
- Remove **dead code, unused imports, unused variables, accidental complexity**.
- Document only **non-obvious decisions, contracts, invariants and edge cases**. Do not comment what the code already says.
- Respect the **existing style, linters, formatters and conventions** of the project.
- Consider **performance, security and maintainability** — without sacrificing clarity unless there is evidence it matters.

---

## Patterns to reach for (only when they add value)

Treat each pattern as a tool, not a goal. Ask: _does this make the code easier to understand, change, or test?_

- **Repository** — isolate data access from domain logic.
- **Service layer** — orchestrate use cases above the domain.
- **Factory** — encapsulate complex construction.
- **Strategy** — swap algorithms behind a common interface.
- **Adapter** — translate between incompatible interfaces at boundaries.
- **Facade** — simplify a complex subsystem for callers.
- **Builder** — assemble objects with many optional parts.
- **Observer / event-driven** — decouple producers and consumers.
- **Dependency Injection** — make dependencies explicit and replaceable.
- **Ports & Adapters / Hexagonal** — isolate the domain from frameworks and IO.
- **CQRS** — only when read and write models diverge meaningfully.
- **DDD tactical patterns** — only when the domain is complex enough to justify the vocabulary.
- **Feature-based architecture** — group by feature, not by technical layer, when features evolve independently.
- **Component composition** (frontend) — prefer composition over prop drilling and god-components.
- **Custom hooks / composables** — extract reusable stateful behavior.
- **DTOs, mappers, validators** — cross boundary translation when types on each side should be independent.

---

## Rules for AI-agent-friendly code

Code should be easy for **both humans and AI agents** to understand, navigate and modify.

- Use **explicit, consistent names** that reveal intent.
- Keep files **small and well organized**; one clear concern per file.
- Avoid **implicit dependencies, magic, and hidden side effects**.
- Prefer **clear interfaces and simple contracts**.
- Provide **enough context in names, structure and tests** that an agent can understand purpose without external knowledge.
- Prefer **pure functions** where possible.
- Design modules with **clear inputs and outputs**.
- Do not spread logic for one concept across many unrelated files.
- Add **tests or executable examples** when they preserve intended behavior or document tricky edge cases.
- Avoid **overly clever, cryptic, or hard-to-reason-about code**.
- Prioritize **boring, stable, explicit, maintainable** code over impressive code.

---

## Evaluation checklist

When generating or reviewing code, evaluate against these dimensions:

1. **Readability** — can a new contributor read it top-to-bottom and understand it?
2. **Simplicity** — is this the simplest thing that works?
3. **Modularity** — are concerns separated into replaceable units?
4. **Scalability** — will this hold up as features and team grow?
5. **Testability** — can behavior be verified without heavy setup or mocks-of-mocks?
6. **Maintainability** — is it easy to change safely?
7. **Separation of responsibilities** — does each module own one reason to change?
8. **Cohesion and coupling** — high inside, low across.
9. **Consistency with the project** — style, patterns, conventions.
10. **Appropriate use of patterns** — present where they help, absent where they would not.
11. **Unnecessary complexity** — any abstraction, layer or option that does not earn its keep?
12. **Readiness for reasonable change** — can the next likely change be made without a rewrite?
13. **Human + AI navigability** — can both read and modify this confidently?

---

## How to respond

When this skill triggers, structure output as follows. Skip sections that do not apply (for example, no "Proposed refactor" for pure code generation of a new file).

### Output format

```markdown
## 1. Quality summary

One short paragraph: overall state of the code (or plan), biggest strengths, biggest risks.

## 2. Main findings

- **[Severity: critical | major | minor]** Short title
  - What: concrete observation with file/line reference when possible.
  - Why it matters: impact on maintainability / scalability / readability / testability.

## 3. Concrete recommendations

Numbered, specific, actionable. Each item must be implementable without further clarification.

## 4. Proposed refactor / improved code

Show the improved code (or diff-like before/after) when it helps. Keep changes minimal and targeted — do not rewrite what was already fine.

## 5. Suggested file / folder structure

Only if structural changes are warranted. Show a tree and one-line purpose per file.

## 6. Final checklist

- [ ] Clean code: names, function size, nesting, dead code
- [ ] SRP and separation of concerns respected
- [ ] Cohesion high, coupling low across modules
- [ ] No unnecessary abstraction, duplication or over-engineering
- [ ] Errors handled explicitly and consistently
- [ ] Testable: deterministic, injectable dependencies, small pure units
- [ ] Scalable: structure supports the next likely change
- [ ] Consistent with project style, linters, conventions
- [ ] Readable and navigable by humans and AI agents
```

### When proposing an improvement

For every issue flagged:

1. **Explain the problem briefly** — no lectures.
2. **State the impact** on maintainability, scalability, clarity, or testability.
3. **Propose a concrete change** — specific, minimal, in the project's style.
4. **Apply the change** when the tools allow it and the user's request implies it.
5. **Do not introduce abstractions that are not justified** by the current or near-future needs.

### Calibration

- Match the **scope of the response to the scope of the request**. A one-function review should not produce an architecture-wide checklist.
- Respect **existing conventions** of the project; do not force a different style for its own sake.
- When in doubt between two valid designs, choose the **simpler, more explicit one** and note the tradeoff in one line.
- Never invent a "best practice" — if a rule is project-specific, say so.

---

## Anti-patterns to call out

Flag these whenever they appear; they are almost always worth fixing:

- God files/classes/components that own unrelated concerns.
- Functions with >~3–4 positional params, or boolean flags that switch behavior.
- Deep nesting where early returns / guards would be clearer.
- Hidden side effects in functions that look pure.
- Business logic embedded in controllers, views, or ORM models.
- Duplicated logic that has drifted between copies.
- Abstractions with a single implementation that just wrap a concrete class.
- Premature generalization ("we might need this later").
- Over-mocked tests that only verify the implementation, not the behavior.
- Dead code, commented-out blocks, TODOs without owner/date.
- Swallowed exceptions, generic `catch` with no action, silent failures.
- Inconsistent naming, mixed casing, leaky acronyms.
- Magic numbers and strings that should be named constants.
- Mixing abstraction levels within a single function.

---

## What NOT to do

- Do **not** turn every review into a rewrite.
- Do **not** add layers (repositories, services, interfaces, DTOs) just because they are canonical — only when they solve a real current problem.
- Do **not** apply Clean Architecture / DDD / Hexagonal to small modules where a flat structure suffices.
- Do **not** write comments that restate the code.
- Do **not** introduce breaking changes under the guise of "cleanup" unless the user asked for that scope.
- Do **not** optimize for performance speculatively; measure first.
- Do **not** change project conventions unilaterally; match them or propose a deliberate migration.

---

## Final objective

Produce and preserve code that is **clean, modern, modular, readable, testable, scalable, maintainable, easy to review and easy to extend — by both humans and AI agents** — while avoiding over-engineering and prioritizing real productivity in serious projects.
