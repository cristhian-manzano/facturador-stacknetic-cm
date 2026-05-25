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
