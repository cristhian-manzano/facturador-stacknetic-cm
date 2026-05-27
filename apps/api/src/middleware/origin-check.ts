/**
 * `originCheckMiddleware` — defence-in-depth CSRF guard.
 *
 * Why: even with the double-submit CSRF cookie (`req.assertCsrf`), an
 * attacker who can read the cookie through a sub-domain misconfiguration
 * or a stolen reverse proxy could still forge the token. The `Origin` /
 * `Referer` header pair, however, is browser-set and immune to
 * JS-side tampering — comparing it to the request's `Host` catches
 * cross-origin attacks at the front door.
 *
 * Behaviour:
 *
 *   - Inspects mutating verbs only: `POST`, `PUT`, `PATCH`, `DELETE`.
 *     `GET`/`HEAD`/`OPTIONS` pass through unchanged so the SOP-safe
 *     methods don't pay the cost.
 *
 *   - Reads the `Origin` header first; falls back to `Referer` if
 *     `Origin` is absent (Safari < 17 omits `Origin` on same-origin
 *     POSTs from form submits — vanishingly rare for this api but cheap
 *     to handle).
 *
 *   - If neither header is present, the request is rejected. Server-to-
 *     server callers must use the service-JWT routes under
 *     `apps/sri-core` instead of the cookie-authenticated `/api/v1`
 *     surface.
 *
 *   - The header host is compared with the request's `Host` (which
 *     Express resolves through `app.set("trust proxy", ...)`); equality
 *     means same-origin. An optional `allowlist` of additional origins
 *     can be passed for future cross-subdomain support — empty by
 *     default.
 *
 * Routes skipped: `/healthz`, `/readyz`. They are read-only probes that
 * still see POSTs only under `kubectl exec` curl rigs, where the Origin
 * header is absent and the verb isn't a mutation anyway. Skipping them
 * keeps probes simple in any environment.
 *
 * Failure: 403 with `code === "auth.csrf_invalid"` (matching the existing
 * CSRF rejection path so the web client's error handling collapses
 * naturally).
 */
import type { RequestHandler } from "express";

import { ForbiddenError } from "@facturador/utils/errors";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SKIP_PATHS = new Set(["/healthz", "/readyz", "/health", "/health-db"]);

export interface OriginCheckOptions {
  /**
   * Additional allowed origin URLs (full origin: scheme + host[:port]).
   * Empty by default — `same-host` is the only allowance. Use this to
   * permit a separately-served web shell (e.g. when `apps/web` runs at
   * `app.example.com` and the api at `api.example.com`).
   */
  allowlist?: readonly string[];
  /**
   * Explicit opt-out for Supertest harnesses where the `Origin` header
   * isn't set on in-process requests. The production server.ts wiring
   * NEVER passes this flag; integration tests that exercise the full
   * router (and don't care to set Origin on every request) pass
   * `{ disabled: true }` for the test-only Express factory.
   */
  disabled?: boolean;
}

/**
 * Extract the origin (scheme://host[:port]) from a header value. Both
 * `Origin` and `Referer` headers carry a full URL — we only need the
 * origin tuple. `null` if the value is unparseable.
 */
function extractOrigin(headerValue: string | undefined): string | null {
  if (headerValue === undefined || headerValue.length === 0) return null;
  try {
    const url = new URL(headerValue);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Build the request's own origin from its `Host` header + protocol.
 * Express populates `req.protocol` from the X-Forwarded-Proto chain
 * when `trust proxy` is set; otherwise it falls back to the socket's
 * encrypted flag.
 */
function requestOrigin(protocol: string, host: string | undefined): string | null {
  if (host === undefined || host.length === 0) return null;
  return `${protocol}://${host}`;
}

export function originCheckMiddleware(options: OriginCheckOptions = {}): RequestHandler {
  const allowlist = new Set(options.allowlist ?? []);
  const disabled = options.disabled ?? false;

  return (req, _res, next) => {
    // Explicit test-mode bypass — kept off-by-default so production
    // wiring never accidentally turns the guard into a no-op.
    if (disabled) {
      next();
      return;
    }
    // Read-only verbs are SOP-safe.
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }

    // Health/readiness probes — skip to keep the operational surface
    // simple in any environment.
    if (SKIP_PATHS.has(req.path)) {
      next();
      return;
    }

    const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const refererHeader = typeof req.headers.referer === "string" ? req.headers.referer : undefined;

    const headerOrigin = extractOrigin(originHeader) ?? extractOrigin(refererHeader);
    const ownOrigin = requestOrigin(req.protocol, req.headers.host);

    // Both headers absent → no way to tell which site is making the
    // request. Reject — cookie-authenticated mutations REQUIRE a browser
    // origin header by RFC 6454.
    if (headerOrigin === null) {
      next(new ForbiddenError("Missing Origin header", "auth.csrf_invalid"));
      return;
    }

    // Same-origin: accept.
    if (ownOrigin !== null && headerOrigin === ownOrigin) {
      next();
      return;
    }

    // Allowlist: accept if the header origin is explicitly trusted.
    if (allowlist.has(headerOrigin)) {
      next();
      return;
    }

    next(new ForbiddenError("Origin/Host mismatch", "auth.csrf_invalid"));
  };
}
