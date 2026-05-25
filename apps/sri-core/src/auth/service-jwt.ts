/**
 * `requireServiceJwt` middleware — verifies the HS256 service token minted
 * by apps/api on every inbound request to /v1/* routes.
 *
 * Source of truth:
 *   - SPEC-0020 §6.3 + §6.5 (middleware chain).
 *   - TASKS-0020 §3.1 (rejection matrix).
 *   - PROMPT-0020 §6 (security policy).
 *
 * Behaviour:
 *   1. Read `Authorization: Bearer <jwt>`.
 *   2. Delegate verification to @facturador/utils/service-jwt with the
 *      shared secret loaded by env.ts. HS256 only, aud=sri-core, iss=api,
 *      exp + 5 s clock tolerance.
 *   3. On success: attach `req.service = { companyId, jti? }` so handlers
 *      can scope every query.
 *   4. On failure: throw a single `AuthError("sri.service_token_invalid")`
 *      with status 401. We deliberately do NOT branch the error message on
 *      the reason (alg / aud / sig / expired all return the same 401) so
 *      the wire surface doesn't leak why exactly the token was rejected.
 *      The structured reason is logged server-side via `req.log`.
 */
import type { RequestHandler } from "express";
import { AuthError } from "@facturador/utils/errors";
import { verifyServiceJwt, type VerifyFailureReason } from "@facturador/utils/service-jwt";

export interface BuildRequireServiceJwtDeps {
  /** Shared HS256 secret; injected by `createApp` so tests can override. */
  readonly secret: string;
}

const SERVICE_TOKEN_ERROR_CODE = "sri.service_token_invalid";

function readBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  if (!header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length === 0 ? undefined : token;
}

export function buildRequireServiceJwt(deps: BuildRequireServiceJwtDeps): RequestHandler {
  return async function requireServiceJwt(req, _res, next) {
    try {
      const token = readBearer(req.header("authorization"));
      if (token === undefined) {
        req.log?.warn(
          { event: "service_jwt.reject", reason: "missing_token" },
          "service token missing",
        );
        throw new AuthError("Service token required", SERVICE_TOKEN_ERROR_CODE);
      }
      const result = await verifyServiceJwt({ token, secret: deps.secret });
      if (!result.ok) {
        req.log?.warn(
          { event: "service_jwt.reject", reason: result.reason satisfies VerifyFailureReason },
          "service token rejected",
        );
        throw new AuthError("Invalid service token", SERVICE_TOKEN_ERROR_CODE);
      }
      // Stamp on the request for downstream handlers. We choose a tiny shape
      // (`companyId` + optional `jti`) on purpose — no PII, no claims dump.
      req.service = {
        companyId: result.claims.sub,
        ...(result.claims.jti === undefined ? {} : { jti: result.claims.jti }),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Re-export the constant so call sites referencing the error code don't have
// to import a stringly-typed magic value.
export const SERVICE_JWT_ERROR_CODE = SERVICE_TOKEN_ERROR_CODE;
