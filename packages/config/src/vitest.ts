/**
 * Shared Vitest config factory for the Facturador monorepo.
 *
 * Single source of truth (SPEC-0007 §1, TASKS-0007 §1.2). Each workspace's
 * `vitest.config.ts` calls `defineFacturadorVitestConfig({ packageName, ... })`
 * to obtain a Vitest config object pre-wired with:
 *
 *   - Globals, the standard `test/setup.ts` setup file (if present).
 *   - V8 coverage with `text` + `lcov` + `html` + `json-summary` reporters.
 *   - `include`/`exclude` defaults for `src/**` (no test files, no index
 *     barrels, no `__fixtures__` / `__tests__` helpers).
 *   - Parallel-friendly thread pool (`maxThreads: 4`, `singleThread: false`)
 *     so the per-test-file DB schema harness can prove isolation.
 *   - Per-package coverage thresholds (statements / branches / lines / functions)
 *     drawn from `DEFAULT_COVERAGE_THRESHOLDS` and overridable per workspace.
 *
 * Thresholds are NEVER relaxed to make a build pass (PROMPT-0007 §2). If your
 * package can't meet them, write more tests — don't lower the bar.
 */
import { defineConfig, type ViteUserConfig } from "vitest/config";

/**
 * Per-package coverage threshold preset. Values mirror SPEC-0007 §FR-2 and
 * TASKS-0007 §6.1. Keys are workspace `name` values from `package.json`.
 */
export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export const DEFAULT_COVERAGE_THRESHOLDS: Record<string, CoverageThresholds> = {
  // Packages — pure logic, ≥ 90% statements + ≥ 80% branches.
  "@facturador/contracts": { statements: 90, branches: 80, functions: 90, lines: 90 },
  "@facturador/utils": { statements: 90, branches: 80, functions: 90, lines: 90 },
  "@facturador/logger": { statements: 90, branches: 80, functions: 90, lines: 90 },
  "@facturador/db": { statements: 90, branches: 80, functions: 90, lines: 90 },
  // Apps — glue code with HTTP boundaries; lower bar.
  "@facturador/api": { statements: 80, branches: 70, functions: 80, lines: 80 },
  "@facturador/sri-core": { statements: 85, branches: 75, functions: 85, lines: 85 },
  "@facturador/web": { statements: 70, branches: 60, functions: 70, lines: 70 },
  // Shared config workspace — exposes a factory; tiny surface.
  "@facturador/config": { statements: 0, branches: 0, functions: 0, lines: 0 },
};

const DEFAULT_FALLBACK_THRESHOLDS: CoverageThresholds = {
  statements: 80,
  branches: 70,
  functions: 80,
  lines: 80,
};

/**
 * Look up the canonical thresholds for a workspace. Falls back to the
 * monorepo's app-level defaults if a name isn't in the table (a new workspace
 * should add itself rather than coast on the fallback).
 */
export function defaultThresholdsFor(packageName: string): CoverageThresholds {
  return DEFAULT_COVERAGE_THRESHOLDS[packageName] ?? DEFAULT_FALLBACK_THRESHOLDS;
}

/**
 * Options for {@link defineFacturadorVitestConfig}. `packageName` is required
 * (drives `test.name`, threshold lookup, coverage report dirs). The other
 * fields are deliberately narrow — adding knobs here means every workspace
 * grows them, which we explicitly try to avoid.
 */
export interface DefineFacturadorVitestConfigOptions {
  /** Workspace package name, e.g. `"@facturador/api"`. */
  packageName: string;
  /** `"node"` (default) or `"jsdom"` (apps/web). */
  environment?: "node" | "jsdom";
  /** Override the auto-resolved thresholds (rare). */
  coverageThresholds?: CoverageThresholds;
  /**
   * Whether to wire `./test/setup.ts` as the setup file. Defaults to `true`.
   * Set to `false` for packages that don't need any setup (e.g. pure schemas).
   */
  includeSetupFile?: boolean;
  /**
   * Extra include patterns appended to the defaults
   * (`src/**\/*.test.ts` + `test/**\/*.test.ts`).
   */
  includeExtra?: string[];
  /**
   * Extra coverage-include patterns appended to `src/**\/*.ts`.
   */
  coverageIncludeExtra?: string[];
  /**
   * Extra coverage-exclude patterns appended to the defaults.
   */
  coverageExcludeExtra?: string[];
}

/**
 * Build a Vitest config tuned for a Facturador workspace.
 *
 * Coverage thresholds are enforced (Vitest fails the run with a non-zero
 * exit code when any of `statements / branches / functions / lines` falls
 * below the configured value).
 */
export function defineFacturadorVitestConfig(
  options: DefineFacturadorVitestConfigOptions,
): ViteUserConfig {
  const {
    packageName,
    environment = "node",
    coverageThresholds,
    includeSetupFile = true,
    includeExtra = [],
    coverageIncludeExtra = [],
    coverageExcludeExtra = [],
  } = options;

  const thresholds = coverageThresholds ?? defaultThresholdsFor(packageName);

  return defineConfig({
    test: {
      name: packageName,
      environment,
      globals: true,
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}", ...includeExtra],
      setupFiles: includeSetupFile ? ["./test/setup.ts"] : [],
      poolOptions: {
        threads: {
          singleThread: false,
          maxThreads: 4,
        },
      },
      coverage: {
        provider: "v8",
        reporter: ["text", "text-summary", "lcov", "html", "json-summary"],
        include: ["src/**/*.{ts,tsx}", ...coverageIncludeExtra],
        exclude: [
          "src/**/index.ts",
          "src/**/*.test.{ts,tsx}",
          "src/**/__tests__/**",
          "src/**/__fixtures__/**",
          "src/env.ts",
          "src/types/**",
          ...coverageExcludeExtra,
        ],
        thresholds: {
          statements: thresholds.statements,
          branches: thresholds.branches,
          functions: thresholds.functions,
          lines: thresholds.lines,
        },
      },
    },
  });
}
