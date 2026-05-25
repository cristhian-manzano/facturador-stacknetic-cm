/**
 * Public surface of the customers module.
 *
 * Re-exports the helper `ensureConsumidorFinal` and the router builder so the
 * orchestrator (SPEC-0033) and the server bootstrap can compose them without
 * pulling internal handlers.
 */
export { ensureConsumidorFinal, type EnsureConsumidorFinalTx } from "./ensure-consumidor-final.js";
export { buildCustomerRouter, type CustomerRouterDeps } from "./routes.js";
export {
  CONSUMIDOR_FINAL_IDENTIFICACION,
  CONSUMIDOR_FINAL_RAZON_SOCIAL,
  CONSUMIDOR_FINAL_TIPO_IDENTIFICACION,
  validateCreate,
  validateUpdate,
} from "./validate.js";
