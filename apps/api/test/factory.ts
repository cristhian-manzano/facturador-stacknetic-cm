/**
 * `createTestApp({ prisma })` — Supertest-friendly factory for `@facturador/api`.
 *
 * Mirrors `src/server.ts`'s `createApp` but wires in test-friendly defaults:
 *
 *   - A capturing Pino destination so log lines can be asserted without
 *     touching stdout (PROMPT-0007 §6: logger must be sandboxed).
 *   - A `getLines()` helper that returns parsed log entries since the last
 *     `clear()`, so individual tests can introspect.
 *   - An optional Prisma client injected from the per-test schema harness
 *     (`@facturador/db/test-harness`).  When omitted, callers MUST stub
 *     `prisma.$queryRaw` themselves — the factory does NOT silently fall
 *     through to the dev-environment singleton (that would defeat isolation).
 *
 * Source of truth: SPEC-0007 §6.4 + TASKS-0007 §3.5.
 */
import { Writable } from "node:stream";

import type { Express } from "express";

import type { PrismaClient } from "@facturador/db";
import { createLogger, type Logger } from "@facturador/logger";

import { createApp } from "../src/server.js";

export interface TestAppHandle {
  /** Express app suitable for Supertest. */
  app: Express;
  /** Captured log lines parsed as JSON; cleared by `clearLines()`. */
  getLines(): unknown[];
  /** Drop any captured lines.  Useful between phases of a single test. */
  clearLines(): void;
  /** The injected logger; tests can attach extra child loggers if needed. */
  logger: Logger;
}

export interface CreateTestAppOptions {
  /**
   * Prisma client pinned to the test's isolated schema. Mandatory for any
   * endpoint that touches the DB; omittable for pure middleware checks.
   */
  prisma?: PrismaClient;
  /**
   * Override the runtime env label used by the logger.  Defaults to "test"
   * so the JSON-only transport is selected and lines stay parseable.
   */
  env?: "development" | "test" | "production";
  /**
   * Override the SRI-Core base URL used by the invoice orchestrator. Tests
   * point this at the MSW stub host (e.g. `http://sri-core.test`).
   */
  sriCoreBaseUrl?: string;
  /** Override the fetch impl used to talk to SRI-Core (MSW-fitted). */
  sriCoreFetchImpl?: typeof fetch;
  /** Override the service-JWT secret used by the invoice orchestrator. */
  serviceJwtSecret?: string;
}

/**
 * Build a Writable that buffers chunks in memory until `read()` is called.
 * Returned from `createTestApp` so individual tests can assert against
 * captured Pino output.
 */
function captureSink(): { stream: Writable; read(): string; reset(): void } {
  let buffers: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      cb();
    },
  });
  return {
    stream,
    read: () => Buffer.concat(buffers).toString("utf8"),
    reset: () => {
      buffers = [];
    },
  };
}

export function createTestApp(options: CreateTestAppOptions = {}): TestAppHandle {
  const sink = captureSink();
  const logger = createLogger({
    service: "api",
    env: options.env ?? "test",
    destination: sink.stream,
  });

  const app = createApp({
    ...(options.prisma === undefined ? {} : { prisma: options.prisma }),
    logger,
    ...(options.sriCoreBaseUrl === undefined ? {} : { sriCoreBaseUrl: options.sriCoreBaseUrl }),
    ...(options.sriCoreFetchImpl === undefined
      ? {}
      : { sriCoreFetchImpl: options.sriCoreFetchImpl }),
    ...(options.serviceJwtSecret === undefined
      ? {}
      : { serviceJwtSecret: options.serviceJwtSecret }),
    // Supertest doesn't set the `Origin` header on in-process requests,
    // so the defence-in-depth originCheckMiddleware would 403 every
    // POST. Disable it for the test factory; production server.ts keeps
    // it on.
    disableOriginCheck: true,
  });

  return {
    app,
    logger,
    getLines: () =>
      sink
        .read()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as unknown),
    clearLines: () => {
      sink.reset();
    },
  };
}
