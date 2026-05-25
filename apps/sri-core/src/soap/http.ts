/**
 * Low-level HTTP transport for SRI SOAP calls.
 *
 * Wraps `undici.request` with:
 *   - A long-lived `Agent` enforcing TLS 1.2+ and `rejectUnauthorized: true`.
 *   - Per-request `bodyTimeout` and `headersTimeout`.
 *   - Typed errors via `SriClientError`.
 *
 * Notes:
 *   - We deliberately use `undici.request` (Dispatcher API), NOT `fetch`,
 *     because `fetch` adds Body streaming semantics we don't need and
 *     the agent connect options are easier to reason about with a
 *     plain dispatcher.
 *   - The agent is a singleton — created once per process and reused
 *     across calls. Tests inject their own `Dispatcher` via the
 *     `dispatcher` parameter (used by `undici-mock-agent`).
 *   - The signed-XML body and the response body are NEVER logged. The
 *     caller may log size + sha256 only.
 *
 * Source of truth:
 *   - SPEC-0025 §6.2 (HTTPS agent), §6.4 (HTTP transport).
 *   - TASKS-0025 §1 (HTTP layer).
 *   - PROMPT-0025 §6 (security policy).
 */
import { Agent, request, type Dispatcher } from "undici";
import { SriClientError } from "./errors.js";

/**
 * TLS configuration locked at TLSv1.2 minimum. The `tls.SecureContext`
 * constants understood by undici/Node are the same as Node's
 * `tls.connect()` options. We never accept TLS 1.0/1.1 — older SRI
 * boxes were reported to fall back; we explicitly reject that.
 *
 * The value is exported so the env-loader + test suite can assert the
 * constant verbatim (PROMPT-0025 "TLS option assertion (1.2 minVersion)").
 */
export const TLS_OPTIONS = Object.freeze({
  minVersion: "TLSv1.2" as const,
  rejectUnauthorized: true as const,
});

/**
 * Default timeouts. SPEC-0025 §FR-5 sets the per-attempt cap; the
 * `httpPostXml` caller can still override the request-level value via
 * the `timeoutMs` parameter when the orchestrator wants a tighter cap.
 *
 * `headersTimeout` is intentionally smaller than `bodyTimeout` so a
 * silent socket stalls fail fast.
 */
export const DEFAULT_TIMEOUTS = Object.freeze({
  bodyTimeoutMs: 30_000,
  headersTimeoutMs: 10_000,
  connectTimeoutMs: 10_000,
});

/** Module-private agent — created lazily so tests can override before first call. */
let defaultAgent: Agent | undefined;

/** Get (or create) the process-wide TLS-hardened agent. */
export function getDefaultAgent(): Agent {
  defaultAgent ??= new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connectTimeout: DEFAULT_TIMEOUTS.connectTimeoutMs,
    connect: {
      ...TLS_OPTIONS,
    },
  });
  return defaultAgent;
}

/** Test seam — let tests reset the cached agent (we never expose to product code). */
export function _resetDefaultAgentForTests(): void {
  defaultAgent = undefined;
}

export interface HttpPostXmlOptions {
  readonly url: string;
  readonly body: string;
  /**
   * Per-attempt body timeout. Defaults to `DEFAULT_TIMEOUTS.bodyTimeoutMs`.
   * The retry wrapper computes a remaining budget separately.
   */
  readonly timeoutMs?: number;
  /**
   * Optional dispatcher override — tests pass a `MockAgent` instance.
   * Production code never passes one.
   */
  readonly dispatcher?: Dispatcher;
  /**
   * Optional `SOAPAction` header. The SRI services accept an empty value;
   * see docs §11 "Configuración HTTPS". The default is `""`.
   */
  readonly soapAction?: string;
}

export interface HttpPostXmlResult {
  readonly status: number;
  readonly text: string;
  /** Elapsed time for the round-trip (ms). */
  readonly elapsedMs: number;
}

/**
 * POST an XML body and read the response text.
 *
 * Throws `SriClientError` for transport-level failures. A 4xx/5xx HTTP
 * status is returned as `{ status, text }`; the retry wrapper is the
 * one that decides whether the status is transient. This separation
 * keeps the HTTP layer pure (no policy decisions).
 */
export async function httpPostXml(opts: HttpPostXmlOptions): Promise<HttpPostXmlResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUTS.bodyTimeoutMs;
  const dispatcher: Dispatcher = opts.dispatcher ?? getDefaultAgent();
  const started = Date.now();

  // SRI's WSDL URLs in env include `?wsdl` — strip that for the actual
  // POST. The service endpoint itself is the same URL minus the query.
  const url = stripWsdlQuery(opts.url);

  try {
    const response = await request(url, {
      method: "POST",
      dispatcher,
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: opts.soapAction ?? "",
        accept: "text/xml, application/soap+xml",
      },
      body: opts.body,
      bodyTimeout: timeoutMs,
      headersTimeout: Math.min(timeoutMs, DEFAULT_TIMEOUTS.headersTimeoutMs),
    });
    const text = await response.body.text();
    return {
      status: response.statusCode,
      text,
      elapsedMs: Date.now() - started,
    };
  } catch (cause) {
    const elapsedMs = Date.now() - started;
    throw classifyTransportError(cause, elapsedMs);
  }
}

/**
 * Map an undici/node transport throw to a typed `SriClientError`. The
 * mapping decides the `transient` flag — `httpPostXml` does not look
 * inside the body to classify, only at error properties.
 *
 * Exported for unit-level testing of the classification matrix.
 */
export function classifyTransportError(cause: unknown, _elapsedMs: number): SriClientError {
  // Undici errors carry a `.code` (e.g. UND_ERR_HEADERS_TIMEOUT) and the
  // underlying socket error usually has `.code` too (ECONNRESET, etc.).
  // We pull both and decide.
  const errCode = readErrorCode(cause);

  if (errCode === "UND_ERR_HEADERS_TIMEOUT" || errCode === "UND_ERR_BODY_TIMEOUT") {
    return new SriClientError("SRI request timed out", {
      kind: "timeout",
      transient: true,
      cause,
    });
  }
  if (errCode === "UND_ERR_CONNECT_TIMEOUT") {
    return new SriClientError("SRI connect timed out", {
      kind: "timeout",
      transient: true,
      cause,
    });
  }
  if (errCode === "ECONNRESET" || errCode === "ETIMEDOUT" || errCode === "EAI_AGAIN") {
    return new SriClientError(`SRI network error: ${errCode}`, {
      kind: "network",
      transient: true,
      cause,
    });
  }
  if (errCode === "ENOTFOUND") {
    return new SriClientError("SRI DNS resolution failed", {
      kind: "network",
      transient: true,
      cause,
    });
  }
  if (errCode === "EPROTO" || errCode === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return new SriClientError("SRI TLS handshake failed", {
      kind: "tls",
      transient: false,
      cause,
    });
  }
  return new SriClientError("SRI transport error", {
    kind: "network",
    transient: true, // default: assume transient so the retry wrapper can try
    cause,
  });
}

function readErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as { code?: unknown; cause?: { code?: unknown } };
  if (typeof obj.code === "string") return obj.code;
  if (obj.cause !== undefined && typeof obj.cause === "object" && obj.cause !== null) {
    const innerCode = (obj.cause as { code?: unknown }).code;
    if (typeof innerCode === "string") return innerCode;
  }
  return undefined;
}

/**
 * Many ops manuals ship the URL with `?wsdl`; the SOAP endpoint itself
 * is the same URL without the query. We strip the query string deliberately
 * so the same env value can be reused with the WSDL discoverer or this
 * client.
 */
export function stripWsdlQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}
