/**
 * Subpath: `@facturador/utils/sri`.
 *
 * SRI-specific pure helpers. Per SPEC-0022, the clave de acceso generator
 * lives here because it is consumed by both `apps/api` (orchestrator) and
 * `apps/sri-core` (XML builder + verification). Re-exports the canonical
 * algorithm (`computeModulo11`), the build entry point, and the validators.
 */
export {
  BuildClaveAccesoError,
  buildClaveAcceso,
  computeModulo11,
  generateCodigoNumerico,
  isValidClaveAcceso,
  parseClaveAcceso,
  validateClaveAcceso,
  type BuildClaveAccesoErrorCode,
  type BuildClaveAccesoInput,
} from "./clave-acceso.js";
