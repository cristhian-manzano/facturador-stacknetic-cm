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

import { SriCircuitOpenError, SriClientError, SriResponseTooLargeError } from "./errors.js";

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
  /**
   * Maximum response size in bytes. Default {@link DEFAULT_MAX_RESPONSE_BYTES}
   * (20 MiB). A response larger than the cap (either announced via
   * Content-Length or observed while streaming chunks) raises
   * {@link SriResponseTooLargeError}. This protects the worker from
   * malformed >100 MB responses that would otherwise OOM
   * `body.text()`.
   */
  readonly maxResponseBytes?: number;
}

/** SPEC-0025 (and the audit punchlist) — 20 MiB cap on SRI responses. */
export const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

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
  // Circuit-breaker short-circuit — the breaker fails-fast when a recent
  // burst of `SriRetryBudgetExceededError`s exceeded the trip threshold.
  const breakerState = peekCircuitState();
  if (breakerState.state === "open") {
    throw new SriCircuitOpenError(undefined, { until: breakerState.openUntilMs });
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUTS.bodyTimeoutMs;
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
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

    // Fail-fast if Content-Length announces a body larger than the cap.
    // We never reach `.text()` so we never buffer the body.
    const cl = readContentLength(response.headers as Record<string, unknown>);
    if (cl !== undefined && cl > maxResponseBytes) {
      // Best-effort drain so the connection can be reused.
      response.body.dump().catch(() => undefined);
      throw new SriResponseTooLargeError(
        `SRI response Content-Length ${String(cl)} exceeds cap ${String(maxResponseBytes)}`,
        { limitBytes: maxResponseBytes, seenBytes: cl },
      );
    }

    // Stream + accumulate; abort if the total ever crosses the cap.
    const text = await readCappedText(response.body, maxResponseBytes);
    return {
      status: response.statusCode,
      text,
      elapsedMs: Date.now() - started,
    };
  } catch (cause) {
    // Surface the typed errors without re-wrapping.
    if (cause instanceof SriResponseTooLargeError) {
      throw cause;
    }
    if (cause instanceof SriClientError) {
      throw cause;
    }
    const elapsedMs = Date.now() - started;
    throw classifyTransportError(cause, elapsedMs);
  }
}

/**
 * Buffer the response body up to `maxBytes`. The moment the running
 * total exceeds the cap we abandon the stream and throw
 * {@link SriResponseTooLargeError}. Returns the decoded UTF-8 string
 * for callers that need to feed it through `parseRecepcionResponse` /
 * `parseAutorizacionResponse`.
 */
async function readCappedText(
  body: AsyncIterable<Buffer | Uint8Array>,
  maxBytes: number,
): Promise<string> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunkRaw of body) {
    const chunk = Buffer.isBuffer(chunkRaw) ? chunkRaw : Buffer.from(chunkRaw);
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new SriResponseTooLargeError(
        `SRI response exceeded cap of ${String(maxBytes)} bytes (read ${String(total)})`,
        { limitBytes: maxBytes, seenBytes: total },
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readContentLength(headers: Record<string, unknown>): number | undefined {
  // undici lowercases header names, but defensively look at all-cases.
  const raw =
    (headers["content-length"] as string | string[] | undefined) ??
    (headers["Content-Length"] as string | string[] | undefined);
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/* -------------------------------------------------------------------------- */
/*                              Circuit breaker                                */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight rolling-window circuit breaker for the SRI transport.
 *
 * Source of truth: audit-punchlist Item 11 (REVIEW-0025 §11 #1).
 *
 *   - Window: 60 s.
 *   - Trip: 10 consecutive `SriRetryBudgetExceededError`s.
 *   - Cool-down: 30 s of `open`.
 *   - Half-open: a single probe request is allowed; success closes the
 *     breaker, failure re-opens it for another cool-down.
 *
 * We deliberately only count `SriRetryBudgetExceededError` (not every
 * SriClientError) because budget-exceeded is the strongest signal that
 * SRI is truly down — transient single-attempt errors are absorbed by
 * `withRetry` and don't need a circuit.
 */
export const DEFAULT_BREAKER_OPTIONS = Object.freeze({
  /** Trip after this many consecutive budget-exceeded errors. */
  failureThreshold: 10,
  /** Sliding window for failures (ms). */
  windowMs: 60_000,
  /** Cool-down after trip (ms). */
  coolDownMs: 30_000,
});

type CircuitState =
  | { state: "closed" }
  | { state: "open"; openUntilMs: number }
  | { state: "half_open" };

interface CircuitBreaker {
  failures: number[]; // epoch ms of recent SriRetryBudgetExceededError
  state: CircuitState;
}

let breaker: CircuitBreaker = { failures: [], state: { state: "closed" } };

/** Reset the circuit breaker. Tests only. */
export function _resetCircuitBreakerForTests(): void {
  breaker = { failures: [], state: { state: "closed" } };
}

/**
 * Look at the breaker state, transitioning out of `open` into
 * `half_open` once the cool-down has elapsed. The transition is what
 * lets the next request through as a probe.
 */
export function peekCircuitState(now: number = Date.now()): CircuitState {
  const s = breaker.state;
  if (s.state === "open" && s.openUntilMs <= now) {
    breaker.state = { state: "half_open" };
    return breaker.state;
  }
  return s;
}

/**
 * Record an outcome from the retry wrapper. Success closes the breaker
 * (and clears the failure window). A `SriRetryBudgetExceededError`
 * appends to the window and trips the breaker once the threshold is
 * crossed.
 */
export function recordCircuitOutcome(
  outcome: "success" | "budget_exceeded",
  now: number = Date.now(),
): void {
  if (outcome === "success") {
    // Half-open success → close. Closed success keeps the window
    // bounded too: any successful response means consecutive failures
    // reset.
    breaker.failures = [];
    breaker.state = { state: "closed" };
    return;
  }
  // budget_exceeded: prune outside-window entries, append now, and
  // trip if threshold crossed.
  const cutoff = now - DEFAULT_BREAKER_OPTIONS.windowMs;
  breaker.failures = breaker.failures.filter((t) => t > cutoff);
  breaker.failures.push(now);
  if (breaker.failures.length >= DEFAULT_BREAKER_OPTIONS.failureThreshold) {
    breaker.state = {
      state: "open",
      openUntilMs: now + DEFAULT_BREAKER_OPTIONS.coolDownMs,
    };
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
  if (obj.cause !== undefined && typeof obj.cause === "object") {
    const innerCode = obj.cause.code;
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
