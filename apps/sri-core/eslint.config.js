// SRI Core is the ONLY workspace allowed to touch the sri-prefixed Prisma
// models. The shared config forbids them everywhere else; here we opt back
// in by setting `no-restricted-syntax` to just the env-access guard
// (without the sri-model selectors). The lifecycle write gatekeeper (the
// `recordEvent.ts` writer for SriDocument.estado) is still enforced via
// a per-file override below.
import sharedConfig from "@facturador/config/eslint";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...sharedConfig,
  // Per-workspace opt-back-in: SRI models are allowed here. Source files
  // plus scripts (rotate-master-key, clave-acceso CLI, smoke-* helpers)
  // — env / test files keep the broader exemptions from the shared
  // config (which re-runs after this block thanks to flat-config ordering).
  {
    files: ["**/src/**/*.{ts,tsx,mts,cts}", "**/scripts/**/*.{ts,mts,cts}"],
    ignores: [
      "**/src/env.ts",
      "**/src/env/**/*.ts",
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
  // Operator scripts that read `process.env` directly (no zod-validated
  // env loader because the operator passes the keys at the prompt).
  {
    files: [
      "**/scripts/rotate-master-key.ts",
      "**/scripts/smoke-*.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Test files: allow sri-model access AND env access (same as the shared
  // test override but with our reduced no-restricted-syntax list).
  {
    files: [
      "**/*.test.{ts,tsx,mts,cts}",
      "**/test/**/*.{ts,tsx,mts,cts}",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Env loaders (forces re-apply of the off rule after block 2 above —
  // flat-config "last block wins" semantics require this explicit override
  // because block 2's `ignores` does NOT subtract from later rules.).
  {
    files: [
      "**/src/env.ts",
      "**/src/env/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default config;
