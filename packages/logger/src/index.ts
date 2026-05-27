/**
 * `@facturador/logger` — Pino-based JSON logger with mandatory redaction.
 *
 * Per SPEC-0006 §6.2 + §6.3 + TASKS-0006 §2.1–2.3:
 *
 *   - `createLogger({ service, env? })` returns a Pino `Logger`.
 *   - Every instance ships with `redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }`
 *     so secrets cannot escape via any code path that uses this logger.
 *   - Base bindings (`service`, `env`, `pid`, `hostname`) are always included.
 *   - The `pino-pretty` transport is enabled ONLY when `NODE_ENV !== "production"`.
 *   - `withRequest(logger, req)` returns a child logger bound to `req.id` so
 *     every line in the request scope carries the correlation ID.
 *
 * Hard constraints (PROMPT-0006):
 *   - Never log `Authorization`/`Cookie` headers, certificates, private keys,
 *     `signedXml`, `claveAcceso`, passwords/hashes — these are all in
 *     `REDACT_PATHS`. The redaction list is extend-only.
 */
import * as os from "node:os";

import pino, { type Logger, type LoggerOptions } from "pino";

import { env as defaultEnv } from "./env.js";
import { REDACT_PATHS } from "./redactions.js";

/** The set of services that can call `createLogger`. */
export type ServiceName = "api" | "sri-core" | "web" | "worker";

/** Subset of `NodeEnv` the logger cares about. */
export type LoggerEnvName = "development" | "test" | "production";

/** Subset of Pino's level values the project uses. */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface CreateLoggerOptions {
  /** Owning service name; emitted in every log line as `service`. */
  readonly service: ServiceName;
  /**
   * Runtime environment. Defaults to the value resolved by the package's
   * own env loader. Tests typically override.
   */
  readonly env?: LoggerEnvName;
  /**
   * Override the log level. Defaults to env-derived value (info in prod,
   * debug in dev/test) per SPEC-0006 §6.2.
   */
  readonly level?: LogLevel;
  /**
   * Optional destination stream (Pino `DestinationStream` shape). Used by
   * tests to capture log output. When provided, the pretty transport is
   * never attached regardless of `env`.
   */
  readonly destination?: pino.DestinationStream;
}

/**
 * Minimal duck-typed interface for an Express `Request` (we avoid pulling
 * `@types/express` into a logger workspace that ships to the web).
 */
export interface RequestLike {
  readonly id?: string;
}

/** Default log level by environment, per SPEC-0006 §6.2. */
const defaultLevel = (env: LoggerEnvName): LogLevel => (env === "production" ? "info" : "debug");

/**
 * Create a configured Pino logger.
 *
 * Behaviour:
 *   - Always installs `redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }`.
 *   - Sets `base: { service, env, pid, hostname }`.
 *   - Adds an ISO-time timestamp formatter so logs are diffable.
 *   - Outputs JSON only (never pretty) when `env === "production"` or when
 *     a `destination` stream is supplied.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const resolvedEnv = options.env ?? (defaultEnv.NODE_ENV as LoggerEnvName);
  const resolvedLevel =
    options.level ?? (defaultEnv.LOG_LEVEL as LogLevel | undefined) ?? defaultLevel(resolvedEnv);

  const baseOpts: LoggerOptions = {
    level: resolvedLevel,
    base: {
      service: options.service,
      env: resolvedEnv,
      pid: process.pid,
      hostname: os.hostname(),
    },
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  // If the caller supplied a destination (typical in tests), bypass the
  // pretty transport entirely so the captured stream contains pure JSON.
  if (options.destination !== undefined) {
    return pino(baseOpts, options.destination);
  }

  if (resolvedEnv !== "production") {
    return pino({
      ...baseOpts,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          singleLine: false,
        },
      },
    });
  }

  return pino(baseOpts);
}

/**
 * Bind a child logger to the request correlation ID. The returned logger
 * inherits the parent's redaction config — fast-redact runs only once at
 * root construction time but Pino applies the configured paths on every
 * `info`/`warn`/`error` call regardless of which child emits the event.
 */
export function withRequest(logger: Logger, req: RequestLike): Logger {
  const requestId = req.id ?? "unknown";
  return logger.child({ requestId });
}

export { REDACT_PATHS } from "./redactions.js";
export type { Logger } from "pino";
