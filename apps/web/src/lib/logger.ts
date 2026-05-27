/**
 * Web-side logger — a thin shim over the browser `console` so call sites
 * have a single import that ESLint's `no-console` rule whitelists.
 *
 * Rationale:
 *   - `packages/logger` (pino) is server-only — it depends on Node APIs.
 *   - The SPA has no remote log sink in v1; we just need a structured
 *     wrapper so production code can log errors WITHOUT tripping the
 *     `no-console` linter or scattering `// eslint-disable` comments.
 *   - Two levels are enough: `error` for ErrorBoundary / unexpected
 *     crashes, `info` for lifecycle (e.g. multi-tab sign-out received).
 *
 * Production might want to ship logs to Sentry / Datadog — that lives
 * behind this single seam.
 */

/* eslint-disable no-console */

export interface Logger {
  readonly error: (...args: unknown[]) => void;
  readonly info: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
}

export const logger: Logger = {
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
  info: (...args: unknown[]): void => {
    console.info(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
};
