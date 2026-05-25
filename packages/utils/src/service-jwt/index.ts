/**
 * Subpath export `@facturador/utils/service-jwt`.
 *
 * Exposes the helpers that mint + verify the HS256 service-to-service
 * JWT used between `apps/api` and `apps/sri-core` (SPEC-0020 §6.3).
 */
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
} from "./service-jwt.js";
