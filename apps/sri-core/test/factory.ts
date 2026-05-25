/**
 * `createTestApp()` — Supertest-friendly factory for `@facturador/sri-core`.
 *
 * Mirrors `src/server.ts`'s `createApp` but routes log lines into a
 * capturing Writable so tests can assert without polluting stdout
 * (SPEC-0007 §6.4 + TASKS-0007 §3.5). For SPEC-0020 integration tests
 * it now accepts an injected Prisma client, service-JWT secret, and
 * stub-mode flag so each test exercises a real round-trip. SPEC-0026
 * adds BlobStore + SOAP-client injection so the orchestrator runs the
 * full pipeline against test doubles.
 */
import { Writable } from "node:stream";
import type { Express } from "express";
import type { PrismaClient } from "@facturador/db";
import { createLogger, type Logger } from "@facturador/logger";
import { createApp } from "../src/server.js";
import type { BlobStore } from "../src/blobs/blob-store.js";
import { InMemoryBlobStore } from "../src/blobs/blob-store.js";
import type { AutorizacionClient, RecepcionClient } from "../src/soap/index.js";

export interface TestAppHandle {
  app: Express;
  getLines(): unknown[];
  clearLines(): void;
  logger: Logger;
  blobStore: BlobStore;
}

export interface CreateTestAppOptions {
  prisma?: PrismaClient;
  serviceJwtSecret?: string;
  stubMode?: boolean;
  blobStore?: BlobStore;
  recepcionClient?: RecepcionClient;
  autorizacionClient?: AutorizacionClient;
}

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
    service: "sri-core",
    env: "test",
    destination: sink.stream,
  });
  const blobStore: BlobStore = options.blobStore ?? new InMemoryBlobStore();
  const app = createApp({
    logger,
    blobStore,
    ...(options.prisma === undefined ? {} : { prisma: options.prisma }),
    ...(options.serviceJwtSecret === undefined
      ? {}
      : { serviceJwtSecret: options.serviceJwtSecret }),
    ...(options.stubMode === undefined ? {} : { stubMode: options.stubMode }),
    ...(options.recepcionClient === undefined ? {} : { recepcionClient: options.recepcionClient }),
    ...(options.autorizacionClient === undefined
      ? {}
      : { autorizacionClient: options.autorizacionClient }),
  });
  return {
    app,
    logger,
    blobStore,
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
