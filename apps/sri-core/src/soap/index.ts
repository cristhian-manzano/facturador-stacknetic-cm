/**
 * Barrel module for the SOAP client layer.
 *
 * Re-exports the public surface so callers (sign-step, lifecycle
 * orchestrator) can `import { RecepcionClient, ... } from "../soap"`
 * without reaching into individual files. The barrel deliberately
 * omits the test seams (`_resetDefaultAgentForTests`, etc.) — those
 * are imported by name only inside test files.
 *
 * Source of truth: SPEC-0025 §6.1.
 */
export {
  buildRecepcionEnvelope,
  buildAutorizacionEnvelope,
  RECEPCION_NAMESPACE,
  AUTORIZACION_NAMESPACE,
  SOAPENV_NAMESPACE,
} from "./envelopes.js";

export {
  parseRecepcionResponse,
  parseAutorizacionResponse,
  normaliseAutorizacionEstado,
  MENSAJE_CLAVE_ACCESO_REGISTRADA,
  type RecepcionParseResult,
  type AutorizacionParseResult,
  type RecepcionEstadoParsed,
  type AutorizacionEstadoParsed,
} from "./parse.js";

export {
  httpPostXml,
  getDefaultAgent,
  TLS_OPTIONS,
  DEFAULT_TIMEOUTS,
  stripWsdlQuery,
  type HttpPostXmlOptions,
  type HttpPostXmlResult,
} from "./http.js";

export {
  withRetry,
  DEFAULT_RETRY_SCHEDULE_MS,
  DEFAULT_RETRY_BUDGET_MS,
  DEFAULT_RETRY_JITTER_MS,
  type WithRetryOptions,
  type RetryAttemptInfo,
} from "./retry.js";

export {
  SriClientError,
  SriRetryBudgetExceededError,
  isTransient,
  type SriClientErrorKind,
  type SriClientErrorOptions,
} from "./errors.js";

export {
  RecepcionClient,
  type RecepcionClientEnv,
  type RecepcionClientOptions,
  type SendRecepcionInput,
  type RecepcionResult,
  type Ambiente,
} from "./recepcion-client.js";

export {
  AutorizacionClient,
  type AutorizacionClientEnv,
  type AutorizacionClientOptions,
  type QueryAutorizacionInput,
  type AutorizacionResult,
} from "./autorizacion-client.js";
