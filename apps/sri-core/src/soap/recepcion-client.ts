/**
 * `RecepcionClient` — high-level orchestrator for the SRI recepción SOAP service.
 *
 * Composition:
 *
 *   signed XML (Buffer)
 *     → base64 → buildRecepcionEnvelope(...) → withRetry(httpPostXml(...))
 *     → parseRecepcionResponse(...) → RecepcionResult
 *
 * The class encapsulates:
 *   - URL selection by `ambiente` (1 = PRUEBAS, 2 = PRODUCCION) — URLs
 *     are pulled from env at construction time and never accepted from
 *     request input.
 *   - Retry policy via `withRetry`. The retry predicate trips only on
 *     transient `SriClientError` throws and on HTTP 5xx responses
 *     (which we re-throw as a transient `SriClientError` inside the
 *     inner closure so the wrapper sees them).
 *   - Optional SHA-256 fingerprint of the response body — for logging
 *     correlation only. The body itself is NEVER logged.
 *   - Mensaje 43 reclassification handled by `parseRecepcionResponse`;
 *     this layer just propagates the result.
 *
 * Hard rules (PROMPT-0025 §6 + TASKS-0025 §7.1):
 *   - The signed XML body and the raw SOAP response NEVER appear in
 *     logs. We log `{ ambiente, claveAcceso?, elapsedMs, httpStatus,
 *     estado, mensajesIds }` only.
 *   - URLs are env-driven. Constructor never accepts a base URL from
 *     user code — it accepts an env snapshot.
 *   - Dispatcher injection is allowed for tests (the SOAP HTTP layer
 *     exposes that seam).
 *
 * Source of truth:
 *   - SPEC-0025 §4 FR-1/3, §6.6 (top-level API).
 *   - PLAN-0025 §4 Phase 4.
 *   - TASKS-0025 §5.1, §6.1, §7.1.
 */
import { createHash } from "node:crypto";

import type { Dispatcher } from "undici";

import type { SriMensaje } from "@facturador/contracts/sri";
import type { Logger } from "@facturador/logger";

import { sriRequestTotal, sriRequestDurationSeconds } from "../metrics.js";

import { buildRecepcionEnvelope } from "./envelopes.js";
import { SriClientError } from "./errors.js";
import { httpPostXml } from "./http.js";
import { parseRecepcionResponse, type RecepcionEstadoParsed } from "./parse.js";
import { withRetry, type WithRetryOptions } from "./retry.js";

/**
 * Ambiente codes used by the SRI ficha técnica — `1` = PRUEBAS,
 * `2` = PRODUCCIÓN. We keep the wire-shape as a tagged-string so the
 * caller can pass the raw value from `SriDocument.ambiente` without
 * mapping.
 */
export type Ambiente = "1" | "2";

export interface RecepcionClientEnv {
  readonly SRI_RECEPCION_URL_PRUEBAS: string;
  readonly SRI_RECEPCION_URL_PRODUCCION: string;
  readonly SRI_HTTP_TIMEOUT_MS: number;
}

export interface RecepcionClientOptions {
  /**
   * Env snapshot. The class never reads `process.env` — the caller
   * forwards a validated subset of the centralised `env` singleton.
   */
  readonly env: RecepcionClientEnv;
  /**
   * Optional logger. Logging is non-PII (no XML, no full mensaje text);
   * the redactor blocks accidental SOAP bodies as a defence in depth.
   */
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  /**
   * Optional dispatcher override (test seam — `MockAgent` instance).
   * Production code never passes one.
   */
  readonly dispatcher?: Dispatcher;
  /** Retry policy overrides (test seam — fast schedule + custom sleep). */
  readonly retry?: WithRetryOptions;
}

export interface SendRecepcionInput {
  /** Signed XML in UTF-8 bytes (per SPEC-0024 producer). */
  readonly signedXml: Buffer;
  /** SRI ambiente — `1` for pruebas, `2` for producción. */
  readonly ambiente: Ambiente;
  /**
   * Optional clave-acceso for telemetry. NEVER used as input to the
   * envelope (the wire carries only base64 of the signed XML). When
   * present it's included in logs to correlate timeline rows.
   */
  readonly claveAcceso?: string;
}

export interface RecepcionResult {
  readonly estado: RecepcionEstadoParsed;
  readonly claveAcceso?: string;
  readonly mensajes: readonly SriMensaje[];
  readonly httpStatus: number;
  readonly durationMs: number;
  /** SHA-256 of the SOAP response body — for log correlation only. */
  readonly rawXmlSha256: string;
  /** `true` when DEVUELTA was reclassified to RECIBIDA via mensaje 43. */
  readonly reclassifiedFromDevuelta: boolean;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class RecepcionClient {
  private readonly env: RecepcionClientEnv;
  private readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  private readonly dispatcher?: Dispatcher;
  private readonly retry?: WithRetryOptions;

  constructor(options: RecepcionClientOptions) {
    this.env = options.env;
    if (options.logger !== undefined) this.logger = options.logger;
    if (options.dispatcher !== undefined) this.dispatcher = options.dispatcher;
    if (options.retry !== undefined) this.retry = options.retry;
  }

  /** Pick the URL for the requested ambiente. Defensive on unknown values. */
  urlFor(ambiente: Ambiente): string {
    return ambiente === "2"
      ? this.env.SRI_RECEPCION_URL_PRODUCCION
      : this.env.SRI_RECEPCION_URL_PRUEBAS;
  }

  async send(input: SendRecepcionInput): Promise<RecepcionResult> {
    const { signedXml, ambiente } = input;
    const url = this.urlFor(ambiente);
    const envelope = buildRecepcionEnvelope({
      signedXmlBase64: signedXml.toString("base64"),
    });

    const started = Date.now();
    const endTimer = sriRequestDurationSeconds.startTimer({ ambiente });
    const post = async (attempt: number) => {
      const result = await httpPostXml({
        url,
        body: envelope,
        timeoutMs: this.env.SRI_HTTP_TIMEOUT_MS,
        ...(this.dispatcher === undefined ? {} : { dispatcher: this.dispatcher }),
      });
      // 5xx → throw a transient SriClientError so `withRetry` retries.
      if (result.status >= 500 && result.status <= 599) {
        throw new SriClientError(`SRI recepción upstream ${String(result.status)}`, {
          kind: "http_5xx",
          transient: true,
          status: result.status,
        });
      }
      // 4xx (other than 5xx) → throw a non-transient SriClientError so
      // `withRetry` propagates immediately. 200/2xx fall through.
      if (result.status >= 400 && result.status <= 499) {
        throw new SriClientError(`SRI recepción rejected request: ${String(result.status)}`, {
          kind: "http_4xx",
          transient: false,
          status: result.status,
        });
      }
      // Defensive — log non-success informational levels only on the
      // first attempt to avoid noise.
      if (attempt === 1) {
        this.logger?.info(
          {
            event: "sri.recepcion.attempt",
            attempt,
            httpStatus: result.status,
            elapsedMs: result.elapsedMs,
            ambiente,
          },
          "sri recepción attempt",
        );
      }
      return result;
    };

    let httpResult: Awaited<ReturnType<typeof httpPostXml>>;
    try {
      httpResult = await withRetry(post, this.retry ?? {});
    } catch (err) {
      // Record an "error" outcome for the metric, then re-throw — the
      // caller still owns the error-handling path.
      sriRequestTotal.inc({ ambiente, outcome: "error" });
      endTimer();
      throw err;
    }
    const parsed = parseRecepcionResponse(httpResult.text);

    const durationMs = Date.now() - started;
    const result: RecepcionResult = {
      estado: parsed.estado,
      mensajes: parsed.mensajes,
      httpStatus: httpResult.status,
      durationMs,
      rawXmlSha256: sha256Hex(httpResult.text),
      reclassifiedFromDevuelta: parsed.reclassifiedFromDevuelta,
      ...(parsed.claveAcceso === undefined ? {} : { claveAcceso: parsed.claveAcceso }),
    };

    // Metric — outcome label is the parsed estado (or "reclassified"
    // when a DEVUELTA was reclassified to RECIBIDA via mensaje 43).
    const outcomeLabel =
      parsed.reclassifiedFromDevuelta
        ? "reclassified"
        : (parsed.estado.toLowerCase() as "recibida" | "devuelta");
    sriRequestTotal.inc({ ambiente, outcome: outcomeLabel });
    endTimer();

    // PII-safe log line — identifiers + tipos only.
    // `claveAcceso` is REDACTED by the centralised REDACT_PATHS even though
    // it's a public field in the wire response — paranoia + defence in depth.
    this.logger?.info(
      {
        event: "sri.recepcion.result",
        ambiente,
        httpStatus: httpResult.status,
        durationMs,
        estado: parsed.estado,
        reclassifiedFromDevuelta: parsed.reclassifiedFromDevuelta,
        mensajesIds: parsed.mensajes.map((m) => ({
          identificador: m.identificador,
          tipo: m.tipo,
        })),
        ...(input.claveAcceso === undefined ? {} : { claveAcceso: input.claveAcceso }),
      },
      "sri recepción complete",
    );

    return result;
  }
}
