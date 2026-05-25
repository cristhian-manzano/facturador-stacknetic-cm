/**
 * Cookie helpers for the session + CSRF double-submit pattern.
 *
 * Source of truth:
 *   - SPEC-0010 §6.2 / §6.7 (cookie attributes).
 *   - TASKS-0010 §1.1 (cookie helper requirements).
 *   - ai/context/security.md (cookie attribute policy).
 *   - ADR-0004 §9 (transport: `__Host-` prefix in production).
 *
 * Cookie naming:
 *   - Production (`NODE_ENV=production`): `__Host-facturador_session` and
 *     `__Host-facturador_csrf`. The `__Host-` prefix is a browser-enforced
 *     contract: cookie MUST set `Secure`, MUST set `Path=/`, MUST NOT set
 *     `Domain`. We only emit the prefixed name when those constraints hold.
 *   - Dev / test: `facturador_session` and `facturador_csrf`. We deliberately
 *     drop the `Secure` flag in non-production so plain-HTTP `localhost`
 *     dev still receives the cookie back on subsequent requests.
 *
 * Attribute matrix:
 *
 *   | Cookie  | HttpOnly | Secure | SameSite | Path |
 *   | ------- | -------- | ------ | -------- | ---- |
 *   | session | yes      | prod   | Lax      | /    |
 *   | csrf    | no       | prod   | Lax      | /    |
 *
 * `HttpOnly` is deliberately false on the CSRF cookie so the SPA can read
 * the token and echo it in the `X-CSRF-Token` header (double-submit). The
 * token *value* alone is useless without a matching session row, so JS
 * readability is acceptable. The cookie value is never logged thanks to
 * the project-wide redaction list (see packages/logger/src/redactions.ts).
 *
 * The pure helpers (`buildSessionCookieOptions`, `buildCsrfCookieOptions`,
 * `buildSessionCookieName`, `buildCsrfCookieName`) accept an `isProduction`
 * boolean parameter so unit tests can exercise both branches deterministically
 * without depending on the order of module loading vs `NODE_ENV` mutation.
 * The public wrappers read `env.NODE_ENV` at call time.
 */

import type { Request, Response, CookieOptions } from "express";
import { env } from "../env.js";

const PROD_SESSION_NAME = "__Host-facturador_session";
const PROD_CSRF_NAME = "__Host-facturador_csrf";
const DEV_SESSION_NAME = "facturador_session";
const DEV_CSRF_NAME = "facturador_csrf";

const isProd = (): boolean => env.NODE_ENV === "production";

// -- Pure builders (parametrised; unit-testable in both branches) -----------

/** Pure builder: production gates the `__Host-` prefix. */
export const buildSessionCookieName = (isProduction: boolean): string =>
  isProduction ? PROD_SESSION_NAME : DEV_SESSION_NAME;

/** Pure builder: production gates the `__Host-` prefix. */
export const buildCsrfCookieName = (isProduction: boolean): string =>
  isProduction ? PROD_CSRF_NAME : DEV_CSRF_NAME;

/**
 * Pure builder for session cookie options.
 *
 * Note `maxAge` is intentionally omitted: the session row in Postgres owns
 * the authoritative `expiresAt`. A `Max-Age` cookie attribute would only
 * inform the browser to drop the cookie locally; the server already rejects
 * expired ids on lookup.
 */
export const buildSessionCookieOptions = (isProduction: boolean): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
});

/** Pure builder for CSRF cookie options. `httpOnly: false` is mandatory. */
export const buildCsrfCookieOptions = (isProduction: boolean): CookieOptions => ({
  httpOnly: false,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
});

// -- Public wrappers (use the live env) -------------------------------------

/** Return the current session cookie name based on `NODE_ENV`. */
export const sessionCookieName = (): string => buildSessionCookieName(isProd());

/** Return the current CSRF cookie name based on `NODE_ENV`. */
export const csrfCookieName = (): string => buildCsrfCookieName(isProd());

export interface SessionCookiePair {
  sessionId: string;
  csrfToken: string;
}

/**
 * Set both cookies on the response. Cookies are written in a fixed order
 * (session first, CSRF second) so Supertest assertions on the
 * `set-cookie` header array are deterministic.
 */
export function setSessionCookies(res: Response, pair: SessionCookiePair): void {
  const prod = isProd();
  res.cookie(buildSessionCookieName(prod), pair.sessionId, buildSessionCookieOptions(prod));
  res.cookie(buildCsrfCookieName(prod), pair.csrfToken, buildCsrfCookieOptions(prod));
}

/**
 * Clear both cookies. Browsers only delete a cookie when the attributes
 * match the original Set-Cookie, so we mirror the attribute matrix
 * (minus `maxAge`/`expires`, which `res.clearCookie` overrides for us).
 */
export function clearSessionCookies(res: Response): void {
  const prod = isProd();
  res.clearCookie(buildSessionCookieName(prod), {
    ...buildSessionCookieOptions(prod),
    maxAge: 0,
  });
  res.clearCookie(buildCsrfCookieName(prod), {
    ...buildCsrfCookieOptions(prod),
    maxAge: 0,
  });
}

/**
 * Read the session cookie. Returns `undefined` if absent or malformed.
 *
 * Cookies are populated by `cookie-parser` middleware; we don't assume the
 * value has been validated as a ULID — that's the session-store's job.
 */
export function readSessionCookie(req: Request): string | undefined {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[sessionCookieName()];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Read the CSRF cookie. Returns `undefined` if absent or malformed. */
export function readCsrfCookie(req: Request): string | undefined {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[csrfCookieName()];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
