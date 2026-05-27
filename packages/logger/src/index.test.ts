/**
 * Tests for `createLogger` + `withRequest`. Per TASKS-0006 §2.3 + §2.4
 * and SPEC-0006 §AC-4, §AC-5.
 *
 * Strategy: pass a custom `destination` stream into the logger so the test
 * receives pure JSON output without spawning the `pino-pretty` transport.
 * Then parse each line and assert that the redaction list converts every
 * sensitive key (including nested ones) to `[REDACTED]`, while preserving
 * untouched fields verbatim.
 */
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger, withRequest, REDACT_PATHS } from "./index.js";

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

describe("createLogger — base bindings", () => {
  it("emits service / env / pid / hostname on every line", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    log.info("hello");
    const [first] = lines();
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.service).toBe("api");
    expect(first.env).toBe("test");
    expect(typeof first.pid).toBe("number");
    expect(typeof first.hostname).toBe("string");
    expect(first.level).toBe("info");
    expect(first.msg).toBe("hello");
    expect(typeof first.time).toBe("string");
    expect(first.time).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("respects the configured level", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", level: "warn", destination: sink });
    log.info("dropped");
    log.warn("kept");
    const captured = lines();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.msg).toBe("kept");
  });
});

describe("createLogger — REDACT_PATHS enforcement", () => {
  it("redacts every PROMPT-listed sensitive field on a synthetic payload", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    log.info(
      {
        signedXml: "<factura><ide>full xml</ide></factura>",
        password: "p455w0rd",
        nested: { passwordHash: "$argon2id$...", ok: 1, privateKey: "BEGIN-PRIVATE" },
      },
      "x",
    );
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.signedXml).toBe("[REDACTED]");
    expect(line.password).toBe("[REDACTED]");
    const nested = line.nested as Record<string, unknown>;
    expect(nested.passwordHash).toBe("[REDACTED]");
    expect(nested.privateKey).toBe("[REDACTED]");
    expect(nested.ok).toBe(1);
  });

  it("redacts csrfToken on the root and nested under any object", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    log.info({ csrfToken: "abc", body: { csrfToken: "xyz", ok: 1 } }, "csrf");
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.csrfToken).toBe("[REDACTED]");
    const body = line.body as Record<string, unknown>;
    expect(body.csrfToken).toBe("[REDACTED]");
    expect(body.ok).toBe(1);
  });

  it("redacts Authorization / Cookie headers when an Express req is logged", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    log.info(
      {
        req: {
          headers: {
            authorization: "Bearer leaked-token",
            cookie: "session=leaked",
            "content-type": "application/json",
          },
        },
      },
      "req",
    );
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    const req = line.req as { headers: Record<string, unknown> };
    expect(req.headers.authorization).toBe("[REDACTED]");
    expect(req.headers.cookie).toBe("[REDACTED]");
    expect(req.headers["content-type"]).toBe("application/json");
  });

  it("redacts Set-Cookie response header", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    log.info(
      {
        res: {
          headers: {
            "set-cookie": ["session=abc; HttpOnly", "csrf=def"],
            "content-type": "application/json",
          },
        },
      },
      "res",
    );
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    const res = line.res as { headers: Record<string, unknown> };
    expect(res.headers["set-cookie"]).toBe("[REDACTED]");
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("redacts certificate payloads and SRI XML buffers", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "sri-core", env: "test", destination: sink });
    log.info(
      {
        cert: {
          p12: Buffer.from("super-secret-pkcs12").toString("base64"),
          p12Buffer: "raw-bytes",
          privateKey: "BEGIN PRIVATE KEY",
          certificatePassphrase: "P@ss",
        },
        sri: {
          signedXml: "<long signed xml>",
          claveAcceso: "0511202401179001234400110010010000000010123456789",
          rawSoapResponse: "<soap:Envelope />",
        },
        contact: { email: "user@example.com", telefono: "+5939..." },
      },
      "fields",
    );
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    const cert = line.cert as Record<string, unknown>;
    expect(cert.p12).toBe("[REDACTED]");
    expect(cert.p12Buffer).toBe("[REDACTED]");
    expect(cert.privateKey).toBe("[REDACTED]");
    expect(cert.certificatePassphrase).toBe("[REDACTED]");
    const sri = line.sri as Record<string, unknown>;
    expect(sri.signedXml).toBe("[REDACTED]");
    expect(sri.claveAcceso).toBe("[REDACTED]");
    expect(sri.rawSoapResponse).toBe("[REDACTED]");
    const contact = line.contact as Record<string, unknown>;
    expect(contact.email).toBe("[REDACTED]");
    expect(contact.telefono).toBe("[REDACTED]");
  });

  it("passes REDACT_PATHS through unchanged so consumers can audit them", () => {
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(12);
  });
});

describe("withRequest", () => {
  it("binds requestId from req.id on every child log line", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    const child = withRequest(log, { id: "01HX8K0PYFA9B7Y1M2N3P4Q5R6" });
    child.info({ password: "x" }, "msg");
    const [line] = lines();
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.requestId).toBe("01HX8K0PYFA9B7Y1M2N3P4Q5R6");
    expect(line.password).toBe("[REDACTED]");
  });

  it("falls back to 'unknown' if req.id is missing", () => {
    const { sink, lines } = captureSink();
    const log = createLogger({ service: "api", env: "test", destination: sink });
    const child = withRequest(log, {});
    child.info("msg");
    const [line] = lines();
    expect(line?.requestId).toBe("unknown");
  });
});
