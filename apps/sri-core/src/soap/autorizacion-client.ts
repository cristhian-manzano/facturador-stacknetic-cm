/**
 * `AutorizacionClient` — high-level orchestrator for the SRI autorización SOAP service.
 *
 * Composition:
 *
 *   claveAcceso (string)
 *     → buildAutorizacionEnvelope(...) → withRetry(httpPostXml(...))
 *     → parseAutorizacionResponse(...) → AutorizacionResult
 *
 * The class is shaped after `RecepcionClient` — both follow the same
 * retry/log policy. The only meaningful differences are:
 *
 *   - The envelope carries `claveAccesoComprobante` instead of a base64
 *     XML body, so the wire payload is short and contains no PII.
 *   - The result includes `numeroAutorizacion`, `fechaAutorizacion`,
 *     `ambiente`, and (when AUTORIZADO) `autorizadoXml` extracted from
 *     the inner `<comprobante>` CDATA.
 *   - `autorizadoXml` MAY contain customer PII — the field is REDACTED
 *     in logs (see REDACT_PATHS for `signedXml`, `xml`,
 *     `authorizedXml`). Callers must persist via the BlobStore and
 *     never serialise it onto a log line.
 *
 * Hard rules (PROMPT-0025 §6 + TASKS-0025 §7.1):
 *   - The signed XML body and the raw SOAP response NEVER appear in
 *     logs.
 *   - URLs are env-driven.
 *   - Dispatcher injection is allowed for tests only.
 *
 * Source of truth:
 *   - SPEC-0025 §4 FR-2/3, §6.6.
 *   - PLAN-0025 §4 Phase 4.
 *   - TASKS-0025 §5.2, §6.1, §7.1.
 */
import { createHash } from "node:crypto";

import type { Dispatcher } from "undici";

import type { SriMensaje } from "@facturador/contracts/sri";
import type { Logger } from "@facturador/logger";

import {
  sriRequestTotal,
  sriRequestDurationSeconds,
  type SriRequestOutcome,
} from "../metrics.js";

import { buildAutorizacionEnvelope } from "./envelopes.js";
import { SriClientError } from "./errors.js";
import { httpPostXml } from "./http.js";
import { parseAutorizacionResponse, type AutorizacionEstadoParsed } from "./parse.js";
import type { Ambiente } from "./recepcion-client.js";
import { withRetry, type WithRetryOptions } from "./retry.js";


export interface AutorizacionClientEnv {
  readonly SRI_AUTORIZACION_URL_PRUEBAS: string;
  readonly SRI_AUTORIZACION_URL_PRODUCCION: string;
  readonly SRI_HTTP_TIMEOUT_MS: number;
}

export interface AutorizacionClientOptions {
  readonly env: AutorizacionClientEnv;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  readonly dispatcher?: Dispatcher;
  readonly retry?: WithRetryOptions;
}

export interface QueryAutorizacionInput {
  readonly claveAcceso: string;
  readonly ambiente: Ambiente;
}

export interface AutorizacionResult {
  readonly estado: AutorizacionEstadoParsed;
  readonly numeroAutorizacion?: string;
  readonly fechaAutorizacion?: string;
  readonly ambiente: "PRODUCCION" | "PRUEBAS" | "DESCONOCIDO";
  /**
   * Embedded `<comprobante>` payload (only present when AUTORIZADO).
   * NEVER log this field — REDACT_PATHS censors it as `authorizedXml`.
   */
  readonly autorizadoXml?: string;
  readonly mensajes: readonly SriMensaje[];
  readonly httpStatus: number;
  readonly durationMs: number;
  /** SHA-256 of the SOAP response body — for log correlation only. */
  readonly rawXmlSha256: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class AutorizacionClient {
  private readonly env: AutorizacionClientEnv;
  private readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  private readonly dispatcher?: Dispatcher;
  private readonly retry?: WithRetryOptions;

  constructor(options: AutorizacionClientOptions) {
    this.env = options.env;
    if (options.logger !== undefined) this.logger = options.logger;
    if (options.dispatcher !== undefined) this.dispatcher = options.dispatcher;
    if (options.retry !== undefined) this.retry = options.retry;
  }

  urlFor(ambiente: Ambiente): string {
    return ambiente === "2"
      ? this.env.SRI_AUTORIZACION_URL_PRODUCCION
      : this.env.SRI_AUTORIZACION_URL_PRUEBAS;
  }

  async query(input: QueryAutorizacionInput): Promise<AutorizacionResult> {
    const { claveAcceso, ambiente } = input;
    const url = this.urlFor(ambiente);
    const envelope = buildAutorizacionEnvelope({ claveAcceso });

    const started = Date.now();
    const endTimer = sriRequestDurationSeconds.startTimer({ ambiente });
    const post = async (attempt: number) => {
      const result = await httpPostXml({
        url,
        body: envelope,
        timeoutMs: this.env.SRI_HTTP_TIMEOUT_MS,
        ...(this.dispatcher === undefined ? {} : { dispatcher: this.dispatcher }),
      });
      if (result.status >= 500 && result.status <= 599) {
        throw new SriClientError(`SRI autorización upstream ${String(result.status)}`, {
          kind: "http_5xx",
          transient: true,
          status: result.status,
        });
      }
      if (result.status >= 400 && result.status <= 499) {
        throw new SriClientError(`SRI autorización rejected request: ${String(result.status)}`, {
          kind: "http_4xx",
          transient: false,
          status: result.status,
        });
      }
      if (attempt === 1) {
        this.logger?.info(
          {
            event: "sri.autorizacion.attempt",
            attempt,
            httpStatus: result.status,
            elapsedMs: result.elapsedMs,
            ambiente,
          },
          "sri autorización attempt",
        );
      }
      return result;
    };

    let httpResult: Awaited<ReturnType<typeof httpPostXml>>;
    try {
      httpResult = await withRetry(post, this.retry ?? {});
    } catch (err) {
      sriRequestTotal.inc({ ambiente, outcome: "error" });
      endTimer();
      throw err;
    }
    const parsed = parseAutorizacionResponse(httpResult.text);
    const durationMs = Date.now() - started;
    // Map parsed estado → metric outcome label.
    const outcomeLabel: SriRequestOutcome =
      parsed.estado === "AUTORIZADO"
        ? "autorizado"
        : parsed.estado === "NO_AUTORIZADO"
          ? "no_autorizado"
          : parsed.estado === "EN_PROCESO"
            ? "en_proceso"
            : "desconocido";
    sriRequestTotal.inc({ ambiente, outcome: outcomeLabel });
    endTimer();

    const result: AutorizacionResult = {
      estado: parsed.estado,
      mensajes: parsed.mensajes,
      ambiente: parsed.ambiente,
      httpStatus: httpResult.status,
      durationMs,
      rawXmlSha256: sha256Hex(httpResult.text),
      ...(parsed.numeroAutorizacion === undefined
        ? {}
        : { numeroAutorizacion: parsed.numeroAutorizacion }),
      ...(parsed.fechaAutorizacion === undefined
        ? {}
        : { fechaAutorizacion: parsed.fechaAutorizacion }),
      ...(parsed.autorizadoXml === undefined ? {} : { autorizadoXml: parsed.autorizadoXml }),
    };

    // PII-safe log. The `numeroAutorizacion` is non-sensitive (it's an SRI
    // identifier that the consumer needs for the citizen-facing PDF). We
    // include it but exclude `autorizadoXml` even from this enriched line.
    this.logger?.info(
      {
        event: "sri.autorizacion.result",
        ambiente,
        httpStatus: httpResult.status,
        durationMs,
        estado: parsed.estado,
        sriAmbiente: parsed.ambiente,
        mensajesIds: parsed.mensajes.map((m) => ({
          identificador: m.identificador,
          tipo: m.tipo,
        })),
        hasAutorizadoXml: parsed.autorizadoXml !== undefined,
        ...(parsed.numeroAutorizacion === undefined
          ? {}
          : { numeroAutorizacion: parsed.numeroAutorizacion }),
        // `claveAcceso` lives in REDACT_PATHS so the redactor masks it
        // — defence in depth: it's not strictly secret, but PII-adjacent.
        claveAcceso,
      },
      "sri autorización complete",
    );

    return result;
  }
}
