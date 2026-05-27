/**
 * `@facturador/utils` — shared platform utilities.
 *
 * Prefer subpath imports:
 *   - `@facturador/utils/errors`   — AppError hierarchy + toProblemDetail.
 *   - `@facturador/utils/audit`    — audit log helper + payload-hash chain.
 *   - `@facturador/utils/rbac`     — permission matrix + `can()` predicate.
 *   - `@facturador/utils/sri`      — SRI clave-de-acceso build + validate.
 *   - `@facturador/utils/context`  — AsyncLocalStorage request context.
 *   - `@facturador/utils/time`     — `nowInEcuador` wall-clock helper.
 *   - `@facturador/utils/hash`     — SHA-256 + IP/email hashing.
 *   - `@facturador/utils/db`       — soft-delete `where` helpers.
 *
 * The barrel re-exports the most commonly consumed names for convenience.
 */
export {
  AppError,
  type AppErrorOptions,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PreconditionRequiredError,
  RateLimitError,
  UpstreamError,
  BusinessError,
  InternalServerError,
  toProblemDetail,
} from "./errors/index.js";

export { audit, type AuditInput, type AuditDependencies } from "./audit/index.js";

export {
  ALL_ACTIONS,
  ALL_ROLES,
  MATRIX,
  actionsForRole,
  can,
  type Action,
  type Role,
} from "./rbac/index.js";

export {
  mintServiceJwt,
  verifyServiceJwt,
  SERVICE_JWT_AUDIENCE,
  SERVICE_JWT_ISSUER,
  SERVICE_JWT_MAX_TTL_SECONDS,
  SERVICE_JWT_CLOCK_TOLERANCE_SECONDS,
  type MintServiceJwtInput,
  type VerifyServiceJwtInput,
  type VerifyServiceJwtResult,
  type VerifyFailureReason,
  type ServiceJwtClaims,
} from "./service-jwt/index.js";

export {
  CIPHER_ALGORITHM,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  MASTER_KEY_BYTES,
  decodeMasterKeyHex,
  decryptEnvelope,
  encryptEnvelope,
  type EncryptedEnvelope,
} from "./crypto/index.js";

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
} from "./sri/index.js";

export {
  runWithContext,
  getContext,
  requireContext,
  type RequestContext,
} from "./context/index.js";

export { nowInEcuador, type EcuadorWallClock } from "./time/index.js";

export { sha256Hex, normaliseIp, hashIp, hashEmail } from "./hash/index.js";

export { isActive, withSoftDelete } from "./db/index.js";

export { canonicalJson, computeAuditPayloadHash } from "./audit/payload-hash.js";
