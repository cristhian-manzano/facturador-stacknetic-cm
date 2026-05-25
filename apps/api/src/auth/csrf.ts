/**
 * CSRF helpers + middleware (double-submit cookie pattern).
 *
 * Source of truth:
 *   - SPEC-0010 §6.6, §FR-5.
 *   - TASKS-0010 §2.1 / §2.2.
 *   - ADR-0004 §8 (CSRF mechanism choice).
 *
 * How the double-submit works:
 *   1. On login, the server mints a fresh random `csrfToken` (32 random
 *      bytes, base64url). The raw token is set as the CSRF cookie (read by
 *      the SPA) and is hashed with SHA-256 before being stored in the
 *      `Session.csrfTokenHash` column.
 *   2. On every mutating verb (POST/PUT/PATCH/DELETE — except `POST
 *      /api/v1/auth/login`), the SPA echoes the cookie value in the
 *      `X-CSRF-Token` header.
 *   3. `assertCsrf` middleware compares cookie + header byte-for-byte
 *      with `crypto.timingSafeEqual`, and ALSO recomputes the SHA-256
 *      digest of the cookie value and compares it to the stored hash on
 *      the session row. Either mismatch → 403 / `csrf.invalid`.
 *
 * This means a stolen cookie value alone is not enough to forge a CSRF
 * token: the attacker also needs a session row that was issued with
 * exactly that token (which only the server can mint).
 */

import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { ForbiddenError } from "@facturador/utils/errors";
import { readCsrfCookie } from "./cookies.js";

/** Mint a 32-byte random CSRF token encoded as base64url (43 chars, no padding). */
export function mintCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Compute the SHA-256 hex digest stored in `Session.csrfTokenHash`. */
export function hashCsrfToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const STATE_CHANGING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that legitimately receive `POST` without a prior session (and
 * therefore without a CSRF cookie). The login handler is the only such
 * route in this slice — same-origin policy + SameSite=Lax + Zod validation
 * are the defences there. Tenant switching (SPEC-0011) WILL require CSRF
 * because the caller is already authenticated.
 */
const CSRF_BYPASS_PATHS = new Set<string>(["/api/v1/auth/login"]);

/**
 * Constant-time string compare. Both arguments are base64url tokens, so we
 * compare their UTF-8 byte buffers. Length mismatch returns false without
 * leaking the longer length (constant-time guarantee is only meaningful
 * when lengths match; we bail explicitly first).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Express middleware enforcing the double-submit CSRF check on mutating
 * requests. MUST run AFTER `requireSession` so it can read `req.session`.
 *
 * Flow:
 *   1. If the method is safe (GET/HEAD/OPTIONS), pass.
 *   2. If the path is on the bypass list (login), pass.
 *   3. Pull cookie value, header value, and stored hash off the session row.
 *      Any of the three missing → 403.
 *   4. Cookie value must equal header value (constant-time).
 *   5. SHA-256 of cookie value must equal stored hash (constant-time on the
 *      hex strings).
 *   6. Otherwise pass.
 *
 * All failure paths throw `ForbiddenError("Invalid CSRF token", "csrf.invalid")`
 * which the terminal error middleware renders as ProblemDetail (403).
 */
export const assertCsrf: RequestHandler = (req, _res, next) => {
  if (!STATE_CHANGING_VERBS.has(req.method)) {
    next();
    return;
  }
  if (CSRF_BYPASS_PATHS.has(req.path)) {
    next();
    return;
  }

  const session = req.session;
  if (session === undefined) {
    // No session = CSRF cannot match a stored hash. Distinct from "no
    // session at all" because `requireSession` should already have thrown
    // 401; if a route accidentally skips it but mounts this middleware,
    // a 403 is the safer fallback.
    next(new ForbiddenError("Invalid CSRF token", "csrf.invalid"));
    return;
  }

  const cookieToken = readCsrfCookie(req);
  const headerToken = req.header("x-csrf-token");

  if (
    cookieToken === undefined ||
    headerToken === undefined ||
    cookieToken.length === 0 ||
    headerToken.length === 0
  ) {
    next(new ForbiddenError("Invalid CSRF token", "csrf.invalid"));
    return;
  }

  if (!constantTimeEqual(cookieToken, headerToken)) {
    next(new ForbiddenError("Invalid CSRF token", "csrf.invalid"));
    return;
  }

  const computedHash = hashCsrfToken(cookieToken);
  if (!constantTimeEqual(computedHash, session.csrfTokenHash)) {
    next(new ForbiddenError("Invalid CSRF token", "csrf.invalid"));
    return;
  }

  next();
};
