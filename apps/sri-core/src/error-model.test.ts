/**
 * End-to-end Supertest assertions for SPEC-0006 — error model & logging
 * wired into apps/sri-core.
 *
 * Mirror of `apps/api/src/error-model.test.ts`. The sri-core surface differs:
 *   - No `/health-db` (no Prisma here).
 *   - The diagnostic echo schema is `{ ping: string }` (no auth surface).
 * Everything else (forced-error matrix, redaction, request-id) is identical.
 */
import { Writable } from "node:stream";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { createLogger } from "@facturador/logger";

import { createApp } from "./server.js";

interface CapturedLine {
  level: string;
  service: string;
  env: string;
  pid: number;
  hostname: string;
  time: string;
  msg?: string;
  [key: string]: unknown;
}

function captureSink(): { sink: Writable; lines: () => CapturedLine[] } {
  const buffers: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      cb();
    },
  });
  return {
    sink,
    lines: () =>
      Buffer.concat(buffers)
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as CapturedLine),
  };
}

const SENSITIVE_LITERALS = [
  "supersecret-pass-9X3",
  "BEGIN PRIVATE KEY",
  "raw-pkcs12-bytes",
  "<factura><signedXml>",
  "sri-clave-acceso-12345",
  "Bearer leaked-bearer-token-42",
  "sessioncookie=leaked-cookie-7",
];

const buildApp = () => {
  const { sink, lines } = captureSink();
  const logger = createLogger({ service: "sri-core", env: "test", destination: sink });
  const app = createApp({ logger });
  return { app, lines };
};

describe("apps/sri-core — error model & logging end-to-end", () => {
  describe("X-Request-Id", () => {
    it("echoes the inbound x-request-id header when valid", async () => {
      const { app } = buildApp();
      const id = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

      const res = await request(app).get("/health").set("x-request-id", id);

      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(id);
    });

    it("mints a fresh ULID when no inbound header is present", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      const id = res.headers["x-request-id"];
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^[0-9A-Z]{26}$/i);
    });
  });

  describe("POST /v1/_diag/echo", () => {
    it("returns 200 for a valid payload", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/v1/_diag/echo")
        .send({ ping: "hello" })
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, ping: "hello" });
    });

    it("returns a valid ProblemDetail (400) with errors[] on a bad payload", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .post("/v1/_diag/echo")
        .send({})
        .set("Content-Type", "application/json");

      expect(res.status).toBe(400);
      const parsed = ProblemDetailSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.code).toBe("validation.failed");
      expect(parsed.data.errors?.length ?? 0).toBeGreaterThanOrEqual(1);
      const idents = parsed.data.errors?.map((m) => m.identificador) ?? [];
      expect(idents).toEqual(expect.arrayContaining(["ping"]));
    });
  });

  describe("GET /v1/_diag/forced-error — full subclass matrix", () => {
    const cases = [
      { type: "auth", status: 401, code: "auth.unauthenticated" },
      { type: "forbidden", status: 403, code: "tenant.forbidden" },
      { type: "not_found", status: 404, code: "invoice.not_found" },
      { type: "conflict", status: 409, code: "invoice.duplicate_clave" },
      { type: "rate_limit", status: 429, code: "rate_limited" },
      { type: "upstream", status: 502, code: "sri.network" },
      { type: "business", status: 422, code: "invoice.totals_mismatch" },
      { type: "validation", status: 400, code: "validation.failed" },
      { type: "unknown", status: 500, code: "internal.unexpected" },
    ] as const;

    it.each(cases)("type=$type → $status / $code", async ({ type, status, code }) => {
      const { app } = buildApp();

      const res = await request(app).get(`/v1/_diag/forced-error?type=${type}`);

      expect(res.status).toBe(status);
      const parsed = ProblemDetailSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.status).toBe(status);
      expect(parsed.data.code).toBe(code);
    });

    it("unknown thrown values never leak the original message", async () => {
      const { app } = buildApp();

      const res = await request(app).get("/v1/_diag/forced-error?type=unknown");

      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain("boom");
      expect(serialised).not.toContain("— unexpected");
      expect((res.body as { detail?: string }).detail).toBeUndefined();
    });
  });

  describe("Redaction in real log output", () => {
    it("never serialises sensitive values into captured log lines", async () => {
      const { app, lines } = buildApp();

      await request(app)
        .post("/v1/_diag/echo")
        .set("Authorization", "Bearer leaked-bearer-token-42")
        .set("Cookie", "sessioncookie=leaked-cookie-7")
        .send({
          ping: "hello",
          password: "supersecret-pass-9X3",
          privateKey: "BEGIN PRIVATE KEY",
          p12: "raw-pkcs12-bytes",
          signedXml: "<factura><signedXml>full</signedXml></factura>",
          claveAcceso: "sri-clave-acceso-12345",
        });

      const captured = lines();
      const serialised = captured.map((l) => JSON.stringify(l)).join("\n");

      for (const literal of SENSITIVE_LITERALS) {
        expect(serialised).not.toContain(literal);
      }
    });

    it("emits a request line with requestId on finish", async () => {
      const { app, lines } = buildApp();
      const id = "01HX8K0PYFA9B7Y1M2N3P4Q5R6";

      await request(app).get("/health").set("x-request-id", id);

      const captured = lines();
      const reqLine = captured.find((l) => l.msg === "request");
      expect(reqLine).toBeDefined();
      if (!reqLine) return;
      expect(reqLine.requestId).toBe(id);
      expect(reqLine.method).toBe("GET");
      expect(reqLine.path).toBe("/health");
      expect(reqLine.status).toBe(200);
    });
  });
});
