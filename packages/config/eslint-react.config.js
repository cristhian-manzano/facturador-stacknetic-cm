// @ts-check
/**
 * Shared ESLint flat config for React workspaces (apps/web).
 *
 * Composition:
 *   1. The base monorepo config (`@facturador/config/eslint`) — TS rules,
 *      project-mandated bans, security plugin, prettier.
 *   2. React, React Hooks, and jsx-a11y rule sets, scoped to `.tsx/.jsx`.
 *   3. A small set of React-specific overrides for the project (no missing
 *      key, exhaustive-deps as error, accessibility on by default).
 *
 * Consumed via `@facturador/config/eslint-react`. The web workspace's own
 * `eslint.config.js` re-exports this array.
 */

import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import baseConfig from "./eslint.config.js";

const REACT_GLOBS = ["**/*.{jsx,tsx}"];

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...baseConfig,

  // React + jsx-a11y rule set.
  {
    files: REACT_GLOBS,
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // --- React core (curated) -------------------------------------------
      // The full "recommended" preset enables ~20 rules; we pick the high-signal
      // subset to keep noise low. New React 17+ JSX transform doesn't need
      // `import React from "react"`, so we disable react-in-jsx-scope.
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/no-children-prop": "error",
      "react/no-danger-with-children": "error",
      "react/no-direct-mutation-state": "error",
      "react/no-find-dom-node": "error",
      "react/no-is-mounted": "error",
      "react/no-render-return-value": "error",
      "react/no-string-refs": "error",
      "react/no-unescaped-entities": "error",
      "react/no-unknown-property": "error",
      "react/require-render-return": "error",

      // --- React Hooks ----------------------------------------------------
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // --- jsx-a11y (curated, high-signal subset) -------------------------
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/html-has-lang": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
];

export default config;
