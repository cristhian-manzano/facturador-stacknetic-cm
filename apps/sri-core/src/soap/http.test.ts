/**
 * Tests for `httpPostXml` and `getDefaultAgent`.
 *
 * Asserts:
 *   - The default `Agent` is constructed with TLS 1.2 minVersion +
 *     rejectUnauthorized=true. We assert via `TLS_OPTIONS` (verbatim
 *     constant) — the policy assertion required by PROMPT-0025 §6.
 *   - `httpPostXml` posts XML with `text/xml; charset=utf-8` content-type
 *     and an empty `SOAPAction` header by default.
 *   - 200 responses are returned verbatim (status + text + elapsedMs).
 *   - 5xx responses are returned as-is (no thrown — the retry wrapper
 *     decides retry policy elsewhere).
 *   - `stripWsdlQuery` removes a trailing `?wsdl` suffix.
 *
 * The mock dispatcher is injected via the `dispatcher` parameter so the
 * agent is bypassed and no real network I/O happens.
 *
 * Source of truth:
 *   - SPEC-0025 §6.2, §6.4.
 *   - TASKS-0025 §1.2 (validation).
 *   - PROMPT-0025 §6 (TLS).
 */
import { afterEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import {
  httpPostXml,
  TLS_OPTIONS,
  stripWsdlQuery,
  getDefaultAgent,
  _resetDefaultAgentForTests,
  classifyTransportError,
  DEFAULT_TIMEOUTS,
} from "./http.js";
import { SriClientError } from "./errors.js";

const FAKE_HOST = "https://sri.example.test";
const FAKE_PATH = "/RecepcionComprobantesOffline";

function makeMockAgent(): { agent: MockAgent; pool: ReturnType<MockAgent["get"]> } {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get(FAKE_HOST);
  return { agent, pool };
}

afterEach(() => {
  _resetDefaultAgentForTests();
});

describe("TLS_OPTIONS — policy assertion", () => {
  it("enforces TLSv1.2 minVersion and rejectUnauthorized=true (verbatim)", () => {
    // PROMPT-0025 hard rule: never accept TLS 1.0/1.1, never disable verify.
    expect(TLS_OPTIONS).toEqual({
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    });
    expect(Object.isFrozen(TLS_OPTIONS)).toBe(true);
  });
});

describe("DEFAULT_TIMEOUTS", () => {
  it("ships sane defaults that the env loader can override", () => {
    expect(DEFAULT_TIMEOUTS.bodyTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUTS.headersTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUTS.connectTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUTS.headersTimeoutMs).toBeLessThanOrEqual(DEFAULT_TIMEOUTS.bodyTimeoutMs);
    expect(Object.isFrozen(DEFAULT_TIMEOUTS)).toBe(true);
  });
});

describe("getDefaultAgent", () => {
  it("returns a singleton across calls", () => {
    const a = getDefaultAgent();
    const b = getDefaultAgent();
    expect(a).toBe(b);
  });

  it("is re-created after the reset seam", () => {
    const a = getDefaultAgent();
    _resetDefaultAgentForTests();
    const b = getDefaultAgent();
    expect(a).not.toBe(b);
  });
});

describe("stripWsdlQuery", () => {
  it("removes ?wsdl when present", () => {
    expect(stripWsdlQuery(`${FAKE_HOST}${FAKE_PATH}?wsdl`)).toBe(`${FAKE_HOST}${FAKE_PATH}`);
  });
  it("leaves URLs without ? alone", () => {
    expect(stripWsdlQuery(`${FAKE_HOST}${FAKE_PATH}`)).toBe(`${FAKE_HOST}${FAKE_PATH}`);
  });
});

describe("httpPostXml — wire format", () => {
  it("posts XML with text/xml content-type and SOAPAction empty header", async () => {
    const { agent, pool } = makeMockAgent();
    let observedHeaders: Record<string, string | string[] | undefined> = {};
    pool
      .intercept({
        path: FAKE_PATH,
        method: "POST",
      })
      .reply((opts) => {
        observedHeaders = (opts.headers ?? {}) as typeof observedHeaders;
        return {
          statusCode: 200,
          data: "<ok/>",
          responseOptions: {
            headers: { "content-type": "text/xml" },
          },
        };
      });

    const r = await httpPostXml({
      url: `${FAKE_HOST}${FAKE_PATH}`,
      body: '<?xml version="1.0"?><x/>',
      dispatcher: agent,
    });
    expect(r.status).toBe(200);
    expect(r.text).toBe("<ok/>");
    expect(typeof r.elapsedMs).toBe("number");

    // Header keys arrive lowercased by undici.
    expect(observedHeaders["content-type"]).toBe("text/xml; charset=utf-8");
    expect(observedHeaders.soapaction).toBe("");
    expect(observedHeaders.accept).toContain("text/xml");
  });

  it("returns 5xx responses as-is (no throw — retry policy is elsewhere)", async () => {
    const { agent, pool } = makeMockAgent();
    pool.intercept({ path: FAKE_PATH, method: "POST" }).reply(503, "<error/>");

    const r = await httpPostXml({
      url: `${FAKE_HOST}${FAKE_PATH}`,
      body: "<x/>",
      dispatcher: agent,
    });
    expect(r.status).toBe(503);
    expect(r.text).toBe("<error/>");
  });

  it("strips ?wsdl from the URL before posting", async () => {
    const { agent, pool } = makeMockAgent();
    let interceptedPath: string | undefined;
    pool.intercept({ path: FAKE_PATH, method: "POST" }).reply((opts) => {
      interceptedPath = opts.path;
      return { statusCode: 200, data: "<ok/>" };
    });

    await httpPostXml({
      url: `${FAKE_HOST}${FAKE_PATH}?wsdl`,
      body: "<x/>",
      dispatcher: agent,
    });
    expect(interceptedPath).toBe(FAKE_PATH);
  });

  it("wraps a transport throw into SriClientError(kind: network) for unknown codes", async () => {
    const { agent, pool } = makeMockAgent();
    pool
      .intercept({ path: FAKE_PATH, method: "POST" })
      .replyWithError(new Error("totally generic boom"));

    await expect(
      httpPostXml({
        url: `${FAKE_HOST}${FAKE_PATH}`,
        body: "<x/>",
        dispatcher: agent,
      }),
    ).rejects.toBeInstanceOf(SriClientError);
  });
});

describe("classifyTransportError — kind matrix", () => {
  const matrix: {
    code: string;
    expectedKind: SriClientError["kind"];
    transient: boolean;
  }[] = [
    { code: "UND_ERR_HEADERS_TIMEOUT", expectedKind: "timeout", transient: true },
    { code: "UND_ERR_BODY_TIMEOUT", expectedKind: "timeout", transient: true },
    { code: "UND_ERR_CONNECT_TIMEOUT", expectedKind: "timeout", transient: true },
    { code: "ECONNRESET", expectedKind: "network", transient: true },
    { code: "ETIMEDOUT", expectedKind: "network", transient: true },
    { code: "EAI_AGAIN", expectedKind: "network", transient: true },
    { code: "ENOTFOUND", expectedKind: "network", transient: true },
    { code: "EPROTO", expectedKind: "tls", transient: false },
    { code: "ERR_TLS_CERT_ALTNAME_INVALID", expectedKind: "tls", transient: false },
  ];

  it.each(matrix)(
    "$code → kind=$expectedKind, transient=$transient",
    ({ code, expectedKind, transient }) => {
      const err = classifyTransportError({ code }, 0);
      expect(err.kind).toBe(expectedKind);
      expect(err.transient).toBe(transient);
    },
  );

  it("uses the inner `.cause.code` when the outer error has no code", () => {
    const err = classifyTransportError({ cause: { code: "ECONNRESET" } }, 0);
    expect(err.kind).toBe("network");
    expect(err.transient).toBe(true);
  });

  it("defaults to kind=network, transient=true for an unrecognised error", () => {
    const err = classifyTransportError(new Error("wat"), 0);
    expect(err.kind).toBe("network");
    expect(err.transient).toBe(true);
  });

  it("handles null + non-object inputs gracefully", () => {
    expect(classifyTransportError(null, 0).kind).toBe("network");
    expect(classifyTransportError("string-error", 0).kind).toBe("network");
  });
});
