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
import unusedImports from "eslint-plugin-unused-imports";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

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
      "unused-imports": unusedImports,
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
                "Import via the workspace package name (e.g. '@facturador/utils'), not relative paths that cross workspace roots.",
            },
          ],
        },
      ],
      "unused-imports/no-unused-imports": "error",
      "import/no-default-export": "error",

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
      "**/packages/db/src/test-harness.ts",
      "**/test/setup.ts",
      "**/packages/db/test/test-harness-internals.test.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // 6b. Test files: allow console + default exports (vitest example configs etc.)
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
