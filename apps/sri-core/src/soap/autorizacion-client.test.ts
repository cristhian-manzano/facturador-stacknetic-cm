/**
 * Mocked integration tests for `AutorizacionClient`.
 *
 * Asserts:
 *   - URL selection by `ambiente`.
 *   - AUTORIZADO: returns numeroAutorizacion + fechaAutorizacion + autorizadoXml.
 *   - EN PROCESO → EN_PROCESO.
 *   - NO AUTORIZADO → NO_AUTORIZADO with mensajes.
 *   - 5xx → retry → success.
 *   - No log line carries the autorizadoXml content.
 *
 * Source of truth:
 *   - SPEC-0025 §AC-3, §AC-4, §AC-5.
 *   - TASKS-0025 §5.2, §7.1.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { MockAgent } from "undici";
import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "@facturador/logger";

import { AutorizacionClient, type AutorizacionClientEnv } from "./autorizacion-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, "..", "..", "test", "fixtures", "soap");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const PRUEBAS_URL = "https://sri-pruebas.test/Autorizacion";
const PROD_URL = "https://sri-prod.test/Autorizacion";

const env: AutorizacionClientEnv = {
  SRI_AUTORIZACION_URL_PRUEBAS: PRUEBAS_URL,
  SRI_AUTORIZACION_URL_PRODUCCION: PROD_URL,
  SRI_HTTP_TIMEOUT_MS: 5_000,
};

const CLAVE = "1234567890123456789012345678901234567890123456789";

const FAST_RETRY = {
  schedule: [1, 1, 1, 1, 1],
  budgetMs: 1_000,
  jitterMs: 0,
  random: () => 0.5,
} as const;

function captureLogger() {
  let bufs: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      bufs.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      cb();
    },
  });
  const logger = createLogger({ service: "sri-core", env: "test", destination: stream });
  return {
    logger,
    read: () => Buffer.concat(bufs).toString("utf8"),
    reset: () => {
      bufs = [];
    },
  };
}

let activeAgent: MockAgent | undefined;
afterEach(async () => {
  if (activeAgent !== undefined) {
    await activeAgent.close();
    activeAgent = undefined;
  }
});

function buildAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  activeAgent = agent;
  return agent;
}

describe("AutorizacionClient — URL selection", () => {
  it("picks PRUEBAS / PRODUCCION URLs by ambiente", () => {
    const c = new AutorizacionClient({ env });
    expect(c.urlFor("1")).toBe(PRUEBAS_URL);
    expect(c.urlFor("2")).toBe(PROD_URL);
  });
});

describe("AutorizacionClient — happy paths", () => {
  it("AUTORIZADO → numeroAutorizacion, fechaAutorizacion, autorizadoXml extracted", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("autorizacion-autorizado.xml"),
    }));

    const c = new AutorizacionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.query({ claveAcceso: CLAVE, ambiente: "1" });
    expect(r.estado).toBe("AUTORIZADO");
    expect(r.ambiente).toBe("PRODUCCION");
    expect(r.numeroAutorizacion).toBe(CLAVE);
    expect(r.fechaAutorizacion).toBe("2026-05-19T10:34:21-05:00");
    expect(r.autorizadoXml).toContain("<factura");
    expect(r.autorizadoXml).toContain("ACME");
  });

  it("EN PROCESO → EN_PROCESO, no autorizadoXml", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("autorizacion-en-proceso.xml"),
    }));

    const c = new AutorizacionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.query({ claveAcceso: CLAVE, ambiente: "1" });
    expect(r.estado).toBe("EN_PROCESO");
    expect(r.autorizadoXml).toBeUndefined();
  });

  it("NO AUTORIZADO → NO_AUTORIZADO with mensajes", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("autorizacion-no-autorizado.xml"),
    }));

    const c = new AutorizacionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.query({ claveAcceso: CLAVE, ambiente: "1" });
    expect(r.estado).toBe("NO_AUTORIZADO");
    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0]?.identificador).toBe("39");
  });
});

describe("AutorizacionClient — retry behaviour", () => {
  it("retries through a 503 then succeeds on AUTORIZADO", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    const replies = [
      { statusCode: 503, data: "<bad/>" },
      { statusCode: 200, data: read("autorizacion-autorizado.xml") },
    ];
    let idx = 0;
    pool
      .intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" })
      .reply(() => replies[idx++] ?? { statusCode: 500, data: "<bug/>" })
      .times(2);

    const c = new AutorizacionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.query({ claveAcceso: CLAVE, ambiente: "1" });
    expect(r.estado).toBe("AUTORIZADO");
    expect(idx).toBe(2);
  });
});

describe("AutorizacionClient — log hygiene", () => {
  it("does not emit the autorizadoXml CDATA content", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("autorizacion-autorizado.xml"),
    }));

    const cap = captureLogger();
    const c = new AutorizacionClient({
      env,
      dispatcher: agent,
      retry: FAST_RETRY,
      logger: cap.logger,
    });
    await c.query({ claveAcceso: CLAVE, ambiente: "1" });

    const lines = cap.read();
    // The CDATA contents — none of these motifs should appear in a log line.
    expect(lines).not.toContain("<factura");
    expect(lines).not.toContain("ACME");
    expect(lines).not.toContain("infoTributaria");
    expect(lines).not.toContain("RespuestaAutorizacionComprobante");
    // Redactor MUST mask the clave-acceso the caller passed. The numero-
    // autorización is a public SRI identifier (printed on the consumer
    // PDF) and is NOT redacted; the assertion below is for the censor
    // string, not for the bare clave.
    expect(lines).toContain("[REDACTED]");
  });
});
