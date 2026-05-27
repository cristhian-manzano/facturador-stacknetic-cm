// @ts-check
/**
 * `@facturador/security` ESLint plugin namespace. Hosts the custom rules
 * we ship for the monorepo (security-critical patterns that the upstream
 * plugins don't cover).
 *
 * Currently registered:
 *
 *   - `require-companyId-filter` — flags Prisma calls on tenant-scoped
 *     models whose first argument's literal `where` omits `companyId`.
 *     See SPEC-0020 §multi-tenant for context. The rule lives in
 *     `./rules/require-companyId-filter.js`.
 *
 * Adding a new rule:
 *
 *   1. Implement it under `./rules/<rule-name>.js` with a CommonJS-style
 *      default export (`export default rule`).
 *   2. Re-export from this barrel under the `rules` object.
 *   3. Reference it in `../eslint.config.js` under
 *      `@facturador/security/<rule-name>` (severity "error").
 *
 * No type-declaration file — ESLint loads plugins through plain Node
 * `require`/`import`, and the project's ESLint config is `// @ts-check`
 * JS rather than TS.
 */

import requireCompanyIdFilter from "./rules/require-companyId-filter.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  rules: {
    "require-companyId-filter": requireCompanyIdFilter,
  },
};

export default plugin;
