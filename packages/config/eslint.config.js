// @ts-check
/**
 * Shared ESLint 9 flat config for the Facturador monorepo.
 *
 * Consumed via `@facturador/config/eslint`. Every workspace member
 * re-exports this array from its own `eslint.config.js`.
 *
 * Composition order (last wins):
 *   1. ignores
 *   2. @eslint/js recommended
 *   3. typescript-eslint strictTypeChecked
 *   4. typescript-eslint stylisticTypeChecked
 *   5. plugins: import, unicorn, promise, n, unused-imports
 *   6. project custom rules (no-console, no-restricted-syntax, no-restricted-imports, ...)
 *   7. per-file overrides
 *   8. eslint-config-prettier (LAST so it can disable formatting rules)
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import unicornPlugin from "eslint-plugin-unicorn";
import promisePlugin from "eslint-plugin-promise";
import nPlugin from "eslint-plugin-n";
import securityPlugin from "eslint-plugin-security";
import unusedImports from "eslint-plugin-unused-imports";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

// `@facturador/security` plugin namespace — hosts our custom rules. See
// `./eslint/index.js` for the plugin definition and `./eslint/rules/*.js`
// for individual rule implementations.
import facturadorSecurityPlugin from "./eslint/index.js";

/**
 * SRI domain isolation: `apps/api` must never touch sri-only Prisma models
 * directly — it MUST go through sri-core's service JWT API. This shared
 * selector list is reused by per-workspace eslint configs to enforce the
 * boundary. The pattern matches `prisma.<model>.<verb>` member expressions.
 *
 * Per REVIEW-0020 §6 and the prompt: models `sriDocument`, `sriEvent`,
 * `certificate` are all forbidden outside `apps/sri-core/**`.
 */
export const FORBIDDEN_SRI_PRISMA_SELECTORS = [
  {
    selector:
      "MemberExpression[object.name='prisma'][property.name=/^(sriDocument|sriEvent|certificate)$/]",
    message:
      "Models prefixed sri/certificate may only be touched from apps/sri-core. Use the service JWT API.",
  },
  {
    // Same pattern but for `tx.<model>` — used inside Prisma transactions.
    selector:
      "MemberExpression[object.name='tx'][property.name=/^(sriDocument|sriEvent|certificate)$/]",
    message:
      "Models prefixed sri/certificate may only be touched from apps/sri-core. Use the service JWT API.",
  },
];

/**
 * Restrict literal `prisma.sriDocument.update({data:{estado:...}})` to the
 * single blessed writer (`apps/sri-core/src/lifecycle/recordEvent.ts`).
 * Catches both `prisma.` and `tx.` callers; the override in the lifecycle
 * file opts back in.
 */
export const FORBIDDEN_SRI_ESTADO_WRITE_SELECTORS = [
  {
    selector:
      "CallExpression[callee.object.property.name='sriDocument'][callee.property.name='update'] > ObjectExpression > Property[key.name='data'] > ObjectExpression > Property[key.name='estado']",
    message:
      "Direct writes to SriDocument.estado are restricted to apps/sri-core/src/lifecycle/recordEvent.ts. Go through recordEvent() so the state machine + audit trail run.",
  },
];

/** @type {import("eslint").Linter.Config[]} */
const config = [
  // 1. Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "**/.turbo/**",
      "**/build/**",
    ],
  },

  // 2. ESLint recommended
  js.configs.recommended,

  // 3. typescript-eslint strict + stylistic, type-checked.
  //    Applied only to TS files; JS gets a non-type-checked variant below.
  ...tseslint.configs.strictTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),

  // 4. TypeScript files: parser project + plugins + custom rules
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: true,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      import: importPlugin,
      unicorn: unicornPlugin,
      promise: promisePlugin,
      n: nPlugin,
      security: securityPlugin,
      "unused-imports": unusedImports,
      // Custom rules under the `@facturador/security` namespace.
      "@facturador/security": facturadorSecurityPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
    rules: {
      // Project-mandated rules (SPEC-0002 §4 + TASKS-0002 §1.2)
      "no-console": "error",
      // SPEC-0020 §multi-tenant — every read/write against a tenant-scoped
      // Prisma model must filter by `companyId`. The rule is implemented
      // in `./eslint/rules/require-companyId-filter.js`; if a call legitimately
      // does not need a tenant filter (e.g. system-level admin scripts),
      // disable it inline with `// eslint-disable-next-line
      // @facturador/security/require-companyId-filter -- <reason>`.
      "@facturador/security/require-companyId-filter": "error",
      // SPEC-0002 §6.3 — eslint-plugin-security subset. We pin the three
      // rules with the lowest false-positive rate; the rest of the plugin's
      // rules tend to fire on honest code without catching real bugs.
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-child-process": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Use packages/<pkg>/src/env.ts for env access (zod-validated). See SPEC-0006.",
        },
        // Domain isolation: api MUST go through sri-core's service JWT API
        // for any sri-only model. Per-workspace overrides in
        // `apps/sri-core/eslint.config.js` opt the sri models back in.
        ...FORBIDDEN_SRI_PRISMA_SELECTORS,
        // Lifecycle gatekeeper: only sri-core/lifecycle/recordEvent.ts may
        // write `SriDocument.estado`. The override lives in that file's
        // workspace eslint config.
        ...FORBIDDEN_SRI_ESTADO_WRITE_SELECTORS,
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/../*", "**/apps/*", "**/packages/*"],
              message:
                "Import via the workspace package name (e.g. '@facturador/utils'), not relative paths that cross workspace roots.",
            },
          ],
        },
      ],
      "unused-imports/no-unused-imports": "error",
      "import/no-default-export": "error",
      // Resolver-backed `no-unresolved` catches `import "@facturador/foo"`
      // typos and missing exports. `eslint-import-resolver-typescript` walks
      // the tsconfig path mappings + workspace `exports` maps. We allow the
      // generated Prisma client (`@facturador/db` re-exports it) without
      // raising the false-positive cost on workspace-internal imports.
      "import/no-unresolved": [
        "error",
        {
          // The vitest globals + node built-ins are resolved by the parser,
          // not by import resolver; ignoring them here avoids known false
          // positives when CI runs lint before tests have populated dist/.
          ignore: ["^node:", "^vitest$", "^vitest/", "\\.css$"],
        },
      ],
      // `import/order` keeps the import block tidy without being overly
      // prescriptive: builtins → external → internal/workspace → parent →
      // sibling → index. Set to `warn` for now — flipping to `error` would
      // churn hundreds of pre-existing files; the warning surfaces the
      // intent and lefthook's `eslint --fix` will normalise on commit.
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [
            {
              pattern: "@facturador/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // Stylistic / safety extras drawn from SPEC-0002 §6.3
      eqeqeq: ["error", "always"],
      "unicorn/prefer-node-protocol": "error",

      // Disable the upstream rule in favour of unused-imports' equivalent
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // `${someNumber}` is auto-stringified at runtime; the `String(...)`
      // wrapping demanded by the default rule hurts readability with no
      // safety benefit (and breaks type-narrowed literal paths in
      // React-Hook-Form). Symbols / objects are still flagged.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // 5. Plain JS / mjs / cjs files (no type-checking): apply recommended + light plugin set
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      import: importPlugin,
      unicorn: unicornPlugin,
      promise: promisePlugin,
      n: nPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Use packages/<pkg>/src/env.ts for env access (zod-validated). See SPEC-0006.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/../*", "**/apps/*", "**/packages/*"],
              message:
                "Import via the workspace package name, not relative paths that cross workspace roots.",
            },
          ],
        },
      ],
      "unused-imports/no-unused-imports": "error",
      eqeqeq: ["error", "always"],
      "unicorn/prefer-node-protocol": "error",
    },
  },

  // 6. Per-file overrides

  // 6a. Centralised env files may read `process.env` directly (the rest of the
  //     codebase must not). The DB test-harness is whitelisted because per-test
  //     schema isolation needs to clone DATABASE_URL at runtime — see SPEC-0007
  //     §6.3 and packages/db/src/test-harness.ts for the rationale. Test setup
  //     files are also exempt — they need to pin `NODE_ENV=test` before the
  //     first test loads any code that reads env.
  {
    files: [
      "**/src/env.ts",
      "**/src/env/index.ts",
      "**/src/env/**/*.ts",
      // Matched relative to each workspace's cwd: when eslint runs from
      // `packages/db`, the file is `src/test-harness.ts` (not
      // `packages/db/src/test-harness.ts`). Use leaf-relative globs so the
      // override applies whether eslint is invoked from the monorepo root
      // or from inside the package.
      "**/src/test-harness.ts",
      "**/test/setup.ts",
      "**/test/test-harness-internals.test.ts",
      // Smoke scripts run via `tsx` against an already-built service; they
      // honour operator-set overrides (e.g. `SRI_CORE_URL`, `SRI_SIGN_ALGO`)
      // and never run in the request path, so the zod-validated env loader
      // is overkill.
      "**/scripts/smoke-*.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // 6b. Test files: allow console + default exports (vitest example configs etc.).
  //     They also need direct `process.env` access for fixtures that fork
  //     subprocesses or read deterministic test-only secrets, and supertest's
  //     `.body` is typed `any` — relaxing `no-unsafe-*` here keeps the test
  //     bodies readable without per-line disable noise (the production code
  //     these tests exercise is still typed-checked strictly).
  {
    files: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/test/**/*.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      "no-console": "off",
      "import/no-default-export": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-deprecated": "off",
      // Tests routinely poke at Prisma directly (lookup by id, set up
      // fixtures across tenants, etc.). The tenant boundary is enforced
      // by the production code these tests exercise — re-asserting it in
      // every fixture line would dilute the signal.
      "@facturador/security/require-companyId-filter": "off",
    },
  },

  // 6c. Vite / Vitest / build-tool configs and React route files require
  //     default exports by framework convention.
  {
    files: [
      "**/vite.config.{ts,js,mts,cts}",
      "**/vitest.config.{ts,js,mts,cts}",
      "**/tailwind.config.{ts,js,mts,cts}",
      "**/postcss.config.{ts,js,mts,cts}",
      "**/apps/web/src/routes/**/*.{ts,tsx}",
      "**/apps/web/src/pages/**/*.{ts,tsx}",
    ],
    rules: {
      "import/no-default-export": "off",
    },
  },

  // 6e. sri-core IS the home of the sri-only Prisma models. Re-enable the
  //     `process.env` rule (sri-core src already follows the env-loader
  //     pattern) but lift the SRI-model + estado-write bans on the whole
  //     workspace EXCEPT routes/handlers (which still must go through
  //     lifecycle helpers). Tests need the lift too.
  {
    files: ["**/apps/sri-core/src/**/*.{ts,tsx}", "**/apps/sri-core/test/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Use packages/<pkg>/src/env.ts for env access (zod-validated). See SPEC-0006.",
        },
        // SRI-model selectors are intentionally OMITTED here — sri-core is
        // the canonical owner of those tables.
        // Keep the estado-write guard active even inside sri-core; the
        // override below opts the single blessed writer back in.
        ...FORBIDDEN_SRI_ESTADO_WRITE_SELECTORS,
      ],
    },
  },

  // 6f. The single blessed writers of `SriDocument.estado`. The state
  //     machine + audit trail run inside `lifecycle/events.ts::recordEvent`
  //     and inside `lifecycle/transitions.ts` (the only other call site
  //     that legitimately mutates `estado` — emit/poll/recordEvent funnel
  //     into a small set of helpers). A direct
  //     `prisma.sriDocument.update({data:{estado}})` is allowed only here.
  {
    files: [
      "**/apps/sri-core/src/lifecycle/events.ts",
      "**/apps/sri-core/src/lifecycle/transitions.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Use packages/<pkg>/src/env.ts for env access (zod-validated). See SPEC-0006.",
        },
      ],
    },
  },

  // 6g. Per-file relaxations of `@facturador/security/require-companyId-filter`.
  //
  //  The rule is strict by default but several call paths legitimately key
  //  off a globally-unique secret (session token) or a column already
  //  guarded by an upstream `findFirst({ where: { id, companyId } })`. The
  //  rationale for each entry is captured below to satisfy code-review
  //  audit trails without scattering per-line disable comments through
  //  the call sites.
  {
    files: [
      // Session lookups + mutations key off the 32-byte secret session
      // token. Forging that token is computationally infeasible, so a
      // tenant filter on top buys nothing. Session.companyId IS still
      // written on tenant-switch (see `switchSessionTenant`); the rule
      // would have to inspect data flow to know that — out of scope.
      "**/apps/api/src/auth/session-store.ts",
      // `auth/handlers.ts::me` returns the caller's memberships across
      // all tenants they belong to (it powers the tenant switcher in
      // the web UI). Tenant filtering would defeat the endpoint.
      "**/apps/api/src/auth/handlers.ts",
      // The background sweep cron deletes rows whose `expiresAt < now()`.
      // Intentionally scope-free: expired tokens of any tenant are stale.
      "**/apps/api/src/auth/session-sweep.ts",
      // Tenant CRUD handlers: `prisma.membership.findMany({ where: { userId } })`
      // returns the caller's memberships across all tenants — that's the
      // whole point of the `/tenants` listing endpoint. Per-tenant filtering
      // would defeat the feature.
      "**/apps/api/src/tenants/handlers.ts",
      // `customers/handlers.ts` updates rows whose `id` was loaded by an
      // upstream `findFirst({ where: { id, companyId } })` and rejected with
      // 404 if cross-tenant. The follow-up `update({ where: { id } })` is
      // safe; adding a tenant filter buys nothing.
      "**/apps/api/src/customers/handlers.ts",
      // Same pattern as customers/handlers.ts.
      "**/apps/api/src/establecimientos/handlers.ts",
      "**/apps/api/src/invoices/orchestrator.ts",
      "**/apps/api/src/invoices/repository.ts",
      // sri-core is the canonical owner of SriDocument + Certificate. Its
      // tenant boundary lives at the service-JWT layer: every request is
      // typed `req.companyId` and every lifecycle helper accepts a
      // pre-validated `claveAcceso + companyId` pair (see
      // `lifecycle/transitions.ts`). Downstream `update({ where: { id } })`
      // calls are safe because the document was loaded by `findFirst` with
      // the tenant binding already enforced.
      //
      // Both monorepo-rooted (`**/apps/sri-core/src/...`) and
      // workspace-rooted (`**/src/...`) globs are listed so the rule is
      // off whether `pnpm lint` runs from the repo root or from
      // `apps/sri-core` (the workspace-local script).
      "**/apps/sri-core/src/certificates/**/*.ts",
      "**/apps/sri-core/src/jobs/**/*.ts",
      "**/apps/sri-core/src/lifecycle/**/*.ts",
      "**/apps/sri-core/src/routes/**/*.ts",
      "**/src/certificates/**/*.ts",
      "**/src/jobs/**/*.ts",
      "**/src/lifecycle/**/*.ts",
      "**/src/routes/**/*.ts",
    ],
    rules: {
      "@facturador/security/require-companyId-filter": "off",
    },
  },

  // 6d. The shared config package's own root config files (this file +
  //     commitlint.config.js + prettier configs) must be lintable without
  //     a TypeScript project context.
  {
    files: ["**/eslint.config.js", "**/commitlint.config.js", "**/prettier.config.{js,cjs,mjs}"],
    rules: {
      "import/no-default-export": "off",
    },
  },

  // 7. Prettier — MUST be last so it disables any formatting rules that
  //    would otherwise conflict.
  prettierConfig,
];

export default config;
