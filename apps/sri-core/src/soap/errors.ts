/**
 * Typed errors raised by the SOAP client layer.
 *
 * The retry wrapper consults the `transient` flag to decide whether to
 * burn another attempt or surface the error immediately. Business
 * failures (DEVUELTA / NO_AUTORIZADO) never travel as errors — they
 * resolve normally and the caller branches on `estado`.
 *
 * NEVER include the SOAP body in `message`. Identifiers and HTTP status
 * codes only. The redactor still strips `rawSoapResponse` if a caller
 * accidentally passes it; this is defence in depth.
 *
 * Source of truth:
 *   - SPEC-0025 §4 FR-4 (retry policy).
 *   - SPEC-0006 §6.3 (error model).
 *   - PROMPT-0025 §6 (security).
 */
export type SriClientErrorKind =
  | "network" // socket-level: ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, fetch abort
  | "timeout" // headers/body timeout hit
  | "http_5xx" // upstream 5xx
  | "http_4xx" // upstream 4xx (non-retryable)
  | "parse" // SRI returned non-XML or unexpected shape
  | "tls"; // TLS handshake failure

export interface SriClientErrorOptions {
  readonly kind: SriClientErrorKind;
  readonly transient: boolean;
  readonly status?: number;
  readonly cause?: unknown;
  /** Stable code consumed by the API error envelope. */
  readonly code?: string;
}

export class SriClientError extends Error {
  readonly kind: SriClientErrorKind;
  readonly transient: boolean;
  readonly status: number | undefined;
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, opts: SriClientErrorOptions) {
    super(message);
    this.name = "SriClientError";
    this.kind = opts.kind;
    this.transient = opts.transient;
    this.status = opts.status;
    this.code = opts.code ?? `sri.${opts.kind}`;
    this.cause = opts.cause;
  }
}

/** Convenience for retry.ts: was this throw transient? */
export function isTransient(err: unknown): boolean {
  return err instanceof SriClientError && err.transient;
}

/** Convenience for callers that need to detect a budget-exhausted retry. */
export class SriRetryBudgetExceededError extends SriClientError {
  constructor(message: string, opts: Omit<SriClientErrorOptions, "kind" | "transient">) {
    super(message, {
      ...opts,
      kind: "network",
      transient: false,
      code: opts.code ?? "sri.retry_budget_exceeded",
    });
    this.name = "SriRetryBudgetExceededError";
  }
}

/**
 * Raised when SRI returns a response larger than the configured cap.
 *
 * The audit punchlist requires a hard ceiling on the autorización SOAP
 * response so a malformed (or hostile) payload cannot OOM the worker.
 * We classify as non-transient — the body itself is what's wrong, not
 * the transport.
 */
export class SriResponseTooLargeError extends SriClientError {
  readonly limitBytes: number;
  readonly seenBytes: number;

  constructor(message: string, opts: { limitBytes: number; seenBytes: number; cause?: unknown }) {
    super(message, {
      kind: "parse",
      transient: false,
      code: "sri.response_too_large",
      ...(opts.cause === undefined ? {} : { cause: opts.cause }),
    });
    this.name = "SriResponseTooLargeError";
    this.limitBytes = opts.limitBytes;
    this.seenBytes = opts.seenBytes;
  }
}

/**
 * Raised when the SRI client's circuit breaker is OPEN and rejects a
 * call without going to the network.
 */
export class SriCircuitOpenError extends SriClientError {
  constructor(message = "SRI circuit breaker is open", opts: { until: number }) {
    super(message, {
      kind: "network",
      transient: false,
      code: "sri.circuit_open",
    });
    this.name = "SriCircuitOpenError";
    this.openUntilMs = opts.until;
  }
  readonly openUntilMs: number;
}
