/**
 * `sequencing` — atomic secuencial reservation + burn helpers.
 *
 * Mounted at `apps/api/src/sequencing/*`. Consumed by:
 *   - The establecimientos / emission-points CRUD handlers (this slice).
 *   - The invoice-emission orchestrator (SPEC-0033).
 *
 * Re-exports both helpers + the small set of supporting types so callers
 * import from `../sequencing/index.js` without reaching into individual
 * files.
 */
export {
  reserveSecuencial,
  DEFAULT_MAX_RETRIES,
  SECUENCIAL_MAX,
  type ReserveSecuencialArgs,
  type ReserveSecuencialDeps,
} from "./reserve.js";
export { burnSecuencial, type BurnSecuencialInput, type BurnSecuencialTx } from "./burn.js";
