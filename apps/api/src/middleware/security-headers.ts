/**
 * `securityHeadersMiddleware` — applies a curated set of defensive HTTP
 * response headers to every request. Mirrors the helmet defaults but
 * keeps the implementation tiny + dependency-free so the surface stays
 * readable in a security audit.
 *
 * Headers set (per OWASP secure-headers project, 2024-05 revision):
 *
 *   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
 *       Only emitted when the request was secure (HTTPS) OR `NODE_ENV` is
 *       `production`. Setting HSTS on a plain-HTTP response is at best a
 *       no-op and at worst confusing in local dev.
 *
 *   - `X-Content-Type-Options: nosniff`
 *       Prevents MIME-type sniffing — closes off a classic XSS via
 *       mislabelled file uploads.
 *
 *   - `X-Frame-Options: DENY`
 *       Defence-in-depth alongside the CSP `frame-ancestors` directive
 *       (we don't ship a CSP yet — TODO when the web shell stabilises).
 *
 *   - `Referrer-Policy: strict-origin-when-cross-origin`
 *       Suppresses leaking the full request path to third-party origins
 *       while keeping it for same-origin navigations.
 *
 *   - `Cross-Origin-Opener-Policy: same-origin`
 *       Isolates the document from cross-origin window references —
 *       gated against XS-Leaks.
 *
 *   - `Cross-Origin-Resource-Policy: same-site`
 *       Pairs with COOP to block cross-site resource embedding.
 *
 * The middleware is idempotent — setting the same header on a route
 * handler that already chose a different value (rare) wins the route's
 * value because `res.setHeader` is the last writer.
 */
import type { RequestHandler } from "express";

import { env } from "../env.js";

const TWO_YEARS_SECONDS = 63_072_000;

export interface SecurityHeadersOptions {
  /**
   * Override the HSTS `max-age`. Tests dial it down so a misconfigured
   * dev box doesn't pin browsers to HTTPS for two years.
   */
  hstsMaxAgeSeconds?: number;
  /**
   * Force-enable HSTS even on non-secure requests. Default `false` so
   * local dev (HTTP) doesn't accidentally pin the developer's browser.
   */
  alwaysSetHsts?: boolean;
}

export function securityHeadersMiddleware(
  options: SecurityHeadersOptions = {},
): RequestHandler {
  const hstsMaxAgeSeconds = options.hstsMaxAgeSeconds ?? TWO_YEARS_SECONDS;
  const alwaysSetHsts = options.alwaysSetHsts ?? false;

  return (req, res, next) => {
    // HSTS is meaningful only over HTTPS or in production (where the
    // reverse proxy terminates TLS — `req.secure` may be false at the
    // Express layer even though the wire is encrypted).
    const isSecure = req.secure || env.NODE_ENV === "production" || alwaysSetHsts;
    if (isSecure) {
      res.setHeader(
        "Strict-Transport-Security",
        `max-age=${String(hstsMaxAgeSeconds)}; includeSubDomains; preload`,
      );
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");

    next();
  };
}
