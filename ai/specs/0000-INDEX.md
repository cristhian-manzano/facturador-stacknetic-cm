# Spec Index — Facturador SRI Ecuador

> Single source of truth for what is being built and in what order. Every spec under `ai/specs/` is meant to be **self-contained**: an AI agent (or human) with no prior knowledge of this conversation must be able to read one spec and implement it correctly.

---

## 0. SDD workflow used in this repo

We follow **Spec-Driven Development** (SDD). The pipeline is:

```
 ai/context/     →  ai/decisions/   →  ai/specs/        →  ai/plans/      →  ai/tasks/       →  ai/reviews/
 (knowledge)        (ADRs)             (what to build)     (how, big-picture)  (how, granular)   (post-impl notes)
```

| Folder          | Purpose                                                                                   | Audience                   |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| `ai/context/`   | Stable knowledge: product, glossary, domain, security.                                    | Everyone.                  |
| `ai/decisions/` | ADRs: architectural decisions with reasoning.                                             | Reviewers, future authors. |
| `ai/specs/`     | **THIS FOLDER.** Functional + technical specifications. The "what" and the precise "how". | Implementers.              |
| `ai/plans/`     | High-level plans / roadmaps spanning multiple specs.                                      | PMs, tech leads.           |
| `ai/tasks/`     | Granular checklists derived from a spec. Per-PR scope.                                    | Implementer mid-flight.    |
| `ai/prompts/`   | Reusable prompt templates for AI agents.                                                  | AI operators.              |
| `ai/reviews/`   | Post-implementation reviews of a spec / PR.                                               | Authors, retrospective.    |

### Spec lifecycle

```
draft → approved → in-progress → implemented → archived
```

A spec status lives in its front-matter (`status:` field). Anything beyond `draft` requires a PR review.

### Rules for authoring specs

1. **Self-contained.** Anyone reading just the spec — without the conversation, without the rest of the repo open — must be able to implement it. Include file paths, exact dependencies (with version pins), data shapes, validation rules, error codes, and acceptance criteria.
2. **No code yet.** Specs describe contracts and constraints. Code goes in PRs against a spec.
3. **Cross-reference.** Link to `ai/context/*`, `ai/decisions/*`, and other specs by relative path. Do **not** duplicate content from `ai/context/` — link to it.
4. **Versioned domain terms.** Use the Spanish SRI vocabulary verbatim (`claveAcceso`, `ambiente`, `estab`, `secuencial`…). See [`ai/context/glossary.md`](../context/glossary.md).
5. **Testable acceptance criteria.** Every spec ends with a numbered list of `AC-n` that a reviewer can check off.

---

## 1. What is being built (recap)

Multi-tenant SaaS for **electronic invoicing in Ecuador (SRI offline scheme)**.

- Initial milestone (this batch of specs): **login → create factura → emit to SRI → receive `AUTORIZADO`**.
- Out of scope for initial milestone: nota de crédito, nota de débito, comprobante de retención, guía de remisión, RIDE PDF generation, email delivery. They will get their own specs later.

Full product context: [`ai/context/product.md`](../context/product.md).

---

## 2. Stack (locked)

| Layer           | Choice                                                              |
| --------------- | ------------------------------------------------------------------- |
| Package manager | **pnpm** with workspaces (monorepo).                                |
| Language        | **TypeScript 5.x** strict mode, ESM modules.                        |
| Runtime         | **Node.js 22 LTS**.                                                 |
| Web app         | **Vite 5 + React 18 + TypeScript**.                                 |
| API             | **Express 5**.                                                      |
| SRI Core        | **Express 5** (own service).                                        |
| Validation      | **Zod** at every boundary (HTTP, forms, env, internal contracts).   |
| ORM             | **Prisma 5**.                                                       |
| Database        | **PostgreSQL 16**.                                                  |
| Tests           | **Vitest** (+ Supertest for HTTP, Playwright optional for E2E).     |
| Linting         | **ESLint 9 (flat config)** + **@typescript-eslint** + **Prettier**. |
| Container       | **Docker** + **docker-compose** for local dev and production.       |
| Logging         | **Pino** with redaction.                                            |

Stack is **not negotiable** within these specs. If a spec needs to deviate, it must produce an ADR first.

---

## 3. Spec map (initial milestone)

Read top-to-bottom. Specs **depend on the ones above** them. A spec lists its hard dependencies in front-matter so blocked work is obvious.

### 3.1 Foundation (`00xx`)

| #    | Spec                                                        | Delivers                                                                           |
| ---- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0001 | [Monorepo & workspace](./0001-monorepo-and-workspace.md)    | pnpm workspaces, folder layout, naming, TS configs.                                |
| 0002 | [Shared tooling](./0002-shared-tooling.md)                  | ESLint flat config, Prettier, EditorConfig, conventional commits, hooks.           |
| 0003 | [Docker & local dev](./0003-docker-and-local-dev.md)        | docker-compose (Postgres, app services), env loading, `.env.example`, dev scripts. |
| 0004 | [Database & Prisma baseline](./0004-database-and-prisma.md) | Prisma setup, migration workflow, multi-tenant base schema, seed strategy.         |
| 0005 | [Shared contracts (Zod)](./0005-shared-contracts.md)        | `@facturador/contracts` package, schemas shared between Web/API/SRI Core.          |
| 0006 | [Error model & logging](./0006-error-model-and-logging.md)  | Uniform error shape, problem-details, Pino logger, audit log table.                |
| 0007 | [Testing strategy](./0007-testing-strategy.md)              | Vitest layout, integration test harness, fixtures policy, coverage targets.        |

### 3.2 Platform (`01xx`)

| #    | Spec                                                               | Delivers                                                                                                           |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 0010 | [Authentication & sessions](./0010-authentication-and-sessions.md) | Login, logout, server-side session per [ADR-0004](../decisions/ADR-0004-auth-session-strategy.md), argon2id, CSRF. |
| 0011 | [Tenants, memberships & RBAC](./0011-tenants-memberships-rbac.md)  | Multi-tenant model, membership roles, tenant switching, request-scoped tenant guard.                               |

### 3.3 SRI Core (`02xx`)

| #    | Spec                                                                      | Delivers                                                                    |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0020 | [SRI Core service bootstrap](./0020-sri-core-service-bootstrap.md)        | Service skeleton, public API, service-to-service auth, error normalization. |
| 0021 | [Certificate management](./0021-certificate-management.md)                | `.p12` upload, encrypted at-rest, metadata, rotation, expiry alerts.        |
| 0022 | [Clave de acceso generator](./0022-clave-acceso-generator.md)             | 49-digit access key algorithm + módulo 11 checksum, deterministic + tested. |
| 0023 | [XML builder — factura V2.1.0](./0023-xml-builder-factura.md)             | Pure builder that produces canonical XML respecting the XSD.                |
| 0024 | [XAdES-BES signer](./0024-xades-bes-signer.md)                            | Enveloped XAdES-BES signing, hash policy, local verification.               |
| 0025 | [SRI SOAP clients (recepción + autorización)](./0025-sri-soap-clients.md) | Two SOAP clients, timeouts, retry, response parsing, error mapping.         |
| 0026 | [Document lifecycle & async jobs](./0026-document-lifecycle-and-jobs.md)  | State machine, persistence, polling job, contingencia handling.             |

### 3.4 Billing API (`03xx`)

| #    | Spec                                                                     | Delivers                                                                       |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0030 | [Emission points & sequencing](./0030-emission-points-and-sequencing.md) | Establecimiento, punto de emisión, atomic secuencial reservation.              |
| 0031 | [Customer catalog](./0031-customer-catalog.md)                           | Customer model, RUC/cédula validation (módulo 10/11), consumidor final.        |
| 0032 | [Invoice domain](./0032-invoice-domain.md)                               | Factura aggregate, totals/IVA arithmetic, business validations.                |
| 0033 | [Invoice emission orchestrator](./0033-invoice-emission-orchestrator.md) | End-to-end orchestration: validate → reserve seq → build → sign → send → poll. |

### 3.5 Web UI (`04xx`)

| #    | Spec                                                              | Delivers                                                                |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0040 | [Web app bootstrap](./0040-web-app-bootstrap.md)                  | Vite + React project, routing, layout shell, API client, design tokens. |
| 0041 | [Web auth flows](./0041-web-auth-flows.md)                        | Login page, session bootstrap, tenant switcher, route guards.           |
| 0042 | [Invoice creation UI](./0042-web-invoice-create.md)               | Factura form, line editor, totals preview, submit + emission status.    |
| 0043 | [Invoice list & detail UI](./0043-web-invoice-list-and-detail.md) | Filterable list, detail page with SRI events timeline, retry actions.   |

---

## 4. Dependency graph (initial milestone)

```
0001 ─┬─ 0002 ─┬─ 0004 ─┬─ 0006 ─┬─ 0010 ─┬─ 0011 ─┬─ 0030 ─┬─ 0032 ─┬─ 0033 ─┬─ 0042
      │        │        │        │                  │        │        ▲        │
      └─ 0003 ─┘        └─ 0005 ─┘                  └─ 0031 ─┘        │        ├─ 0043
                                                                       │        │
                              0007 (cross-cutting; reference from all) │        │
                                                                       │        │
                              0020 ─┬─ 0021 ────────────────────────── │        │
                                    ├─ 0022 ─┬─ 0023 ─┬─ 0024 ─┬─ 0025 ┴─ 0026 ─┘
                                                                                ▲
                                                              0040 ─┬─ 0041 ───┘
```

Implementation order = topological order of the graph. The shortest path to "login + emit factura" is:

`0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0010 → 0011 → 0020 → 0021 → 0022 → 0023 → 0024 → 0025 → 0026 → 0030 → 0031 → 0032 → 0033 → 0040 → 0041 → 0042 → 0043`

---

## 5. Conventions every spec must follow

- **Front-matter (YAML)** at the top of each file: `id`, `title`, `status`, `owner`, `created`, `updated`, `depends_on`, `blocks`.
- **Headings.** `# SPEC-XXXX — Title`, then numbered H2 sections.
- **Acceptance criteria** at the bottom as `AC-1`, `AC-2`, … each independently checkable.
- **Code blocks** in fenced TS/SQL/JSON. No screenshots.
- **External links** use full URLs.
- **Internal links** are relative paths.

---

## 6. Out of scope for this initial spec batch

These topics will get their own spec files later (do **not** add them to current specs):

- Nota de crédito, nota de débito, comprobante de retención, guía de remisión (3 separate specs each: domain, XML builder, orchestration).
- RIDE PDF generation (separate spec, depends on PDF skill).
- Email/portal delivery to receptor.
- Reporting / analytics dashboards.
- Public integrator API (per ADR-0004 §11; separate ADR + spec).
- Native mobile app.
- Internationalization (only Spanish for v1).
- Production CI/CD pipeline (separate spec when we have a target host).

---

## 7. Glossary pointer

Every Spanish/SRI term is defined exactly once in [`ai/context/glossary.md`](../context/glossary.md). Specs link to it instead of restating definitions.

## 8. Change log

| Date       | Change                                                                   | By                       |
| ---------- | ------------------------------------------------------------------------ | ------------------------ |
| 2026-05-19 | Initial spec batch (0001–0043, foundation through web factura emission). | Project owner via Claude |
