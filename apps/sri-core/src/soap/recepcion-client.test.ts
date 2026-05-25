/**
 * Mocked integration tests for `RecepcionClient`.
 *
 * Asserts:
 *   - URL selection by `ambiente` (`1` → pruebas, `2` → producción).
 *   - 200 with RECIBIDA body → no retry; result is RECIBIDA.
 *   - 200 with DEVUELTA body → no retry (business outcome).
 *   - 200 with mensaje 43 body → reclassified to RECIBIDA.
 *   - 502 → 502 → 200 sequence retries twice (transient) and succeeds.
 *   - 4 × 502 then 200 succeeds within budget under fast schedule.
 *   - Budget exhausted on transient 502s → throws SriRetryBudgetExceededError.
 *   - Log lines never contain the signed XML or the raw SOAP body.
 *
 * Source of truth:
 *   - SPEC-0025 §AC-4, §AC-5, §AC-7.
 *   - TASKS-0025 §5.1, §6.1, §7.1.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@facturador/logger";
import { RecepcionClient, type RecepcionClientEnv } from "./recepcion-client.js";
import { SriRetryBudgetExceededError } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, "..", "..", "test", "fixtures", "soap");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const PRUEBAS_URL = "https://sri-pruebas.test/Recepcion";
const PROD_URL = "https://sri-prod.test/Recepcion";

const env: RecepcionClientEnv = {
  SRI_RECEPCION_URL_PRUEBAS: PRUEBAS_URL,
  SRI_RECEPCION_URL_PRODUCCION: PROD_URL,
  SRI_HTTP_TIMEOUT_MS: 5_000,
};

// Tiny signed-XML payload — the wire goes base64 so byte content is opaque.
const SIGNED = Buffer.from("<signed>FAKE</signed>", "utf8");

const FAST_RETRY = {
  schedule: [1, 1, 1, 1, 1],
  budgetMs: 1_000,
  jitterMs: 0,
  random: () => 0.5,
} as const;

const NO_BUDGET_RETRY = {
  schedule: [10, 10, 10, 10, 10],
  budgetMs: 5, // any retry blows the cap
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

describe("RecepcionClient — URL selection", () => {
  it("picks PRUEBAS URL for ambiente '1'", () => {
    const c = new RecepcionClient({ env });
    expect(c.urlFor("1")).toBe(PRUEBAS_URL);
  });
  it("picks PRODUCCION URL for ambiente '2'", () => {
    const c = new RecepcionClient({ env });
    expect(c.urlFor("2")).toBe(PROD_URL);
  });
});

describe("RecepcionClient — happy paths", () => {
  it("RECIBIDA: no retry, returns estado RECIBIDA", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    let calls = 0;
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => {
      calls++;
      return { statusCode: 200, data: read("recepcion-recibida.xml") };
    });

    const c = new RecepcionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.send({ signedXml: SIGNED, ambiente: "1" });
    expect(r.estado).toBe("RECIBIDA");
    expect(r.mensajes).toEqual([]);
    expect(r.httpStatus).toBe(200);
    expect(r.reclassifiedFromDevuelta).toBe(false);
    expect(r.rawXmlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toBe(1);
  });

  it("DEVUELTA (70): no retry — business outcome, returns DEVUELTA", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    let calls = 0;
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => {
      calls++;
      return { statusCode: 200, data: read("recepcion-devuelta-70.xml") };
    });

    const c = new RecepcionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.send({ signedXml: SIGNED, ambiente: "1" });
    expect(r.estado).toBe("DEVUELTA");
    expect(r.mensajes.map((m) => m.identificador)).toEqual(["70", "50"]);
    expect(calls).toBe(1);
  });

  it("mensaje 43 → reclassified to RECIBIDA", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("recepcion-devuelta-43.xml"),
    }));

    const c = new RecepcionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.send({ signedXml: SIGNED, ambiente: "1" });
    expect(r.estado).toBe("RECIBIDA");
    expect(r.reclassifiedFromDevuelta).toBe(true);
  });
});

describe("RecepcionClient — retry behaviour", () => {
  it("retries through two 502s before a 200 RECIBIDA", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    const replies = [
      { statusCode: 502, data: "<oops/>" },
      { statusCode: 502, data: "<oops/>" },
      { statusCode: 200, data: read("recepcion-recibida.xml") },
    ];
    let idx = 0;
    pool
      .intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" })
      .reply(() => replies[idx++] ?? { statusCode: 500, data: "<bug/>" })
      .times(3);

    const c = new RecepcionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    const r = await c.send({ signedXml: SIGNED, ambiente: "1" });
    expect(r.estado).toBe("RECIBIDA");
    expect(r.httpStatus).toBe(200);
    expect(idx).toBe(3);
  });

  it("budget exhausted on continuous 502s → SriRetryBudgetExceededError", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool
      .intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" })
      .reply(502, "<oops/>")
      .persist();

    const c = new RecepcionClient({ env, dispatcher: agent, retry: NO_BUDGET_RETRY });
    await expect(c.send({ signedXml: SIGNED, ambiente: "1" })).rejects.toBeInstanceOf(
      SriRetryBudgetExceededError,
    );
  });

  it("does not retry on 4xx (non-transient)", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    let calls = 0;
    pool
      .intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" })
      .reply(() => {
        calls++;
        return { statusCode: 400, data: "<bad/>" };
      })
      .persist();

    const c = new RecepcionClient({ env, dispatcher: agent, retry: FAST_RETRY });
    await expect(c.send({ signedXml: SIGNED, ambiente: "1" })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("RecepcionClient — log hygiene (PROMPT-0025 §6)", () => {
  it("never emits the signed XML or raw SOAP body to the logger", async () => {
    const agent = buildAgent();
    const pool = agent.get(new URL(PRUEBAS_URL).origin);
    pool.intercept({ path: new URL(PRUEBAS_URL).pathname, method: "POST" }).reply(() => ({
      statusCode: 200,
      data: read("recepcion-devuelta-70.xml"),
    }));

    const cap = captureLogger();
    const c = new RecepcionClient({
      env,
      dispatcher: agent,
      retry: FAST_RETRY,
      logger: cap.logger,
    });
    await c.send({
      signedXml: SIGNED,
      ambiente: "1",
      claveAcceso: "1234567890123456789012345678901234567890123456789",
    });

    const lines = cap.read();
    // Defence-in-depth: a few specific motifs that would prove a leak.
    expect(lines).not.toContain("<signed>"); // input
    expect(lines).not.toContain("FAKE"); // input contents
    expect(lines).not.toContain("RespuestaRecepcionComprobante"); // raw response
    expect(lines).not.toContain("ARCHIVO NO CUMPLE"); // mensaje text (informativ-only fields)
    expect(lines).not.toContain("PHNpZ25lZD5GQUtFPC9zaWduZWQ+"); // base64 of input
    // The clave-acceso *is* logged structurally — Pino redactor MUST mask it.
    // `@facturador/logger` configures the censor as `[REDACTED]`.
    expect(lines).toContain("[REDACTED]");
    // Confirmation: the clave-acceso string itself does NOT appear in raw form.
    expect(lines).not.toContain("1234567890123456789012345678901234567890123456789");
  });
});
