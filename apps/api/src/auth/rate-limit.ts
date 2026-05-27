/**
 * Login rate limiting.
 *
 * Source of truth:
 *   - SPEC-0010 §FR-7 + §6.8.
 *   - TASKS-0010 §7.1.
 *   - PLAN-0010 §4 phase 5.
 *
 * Two limiters mounted on `POST /api/v1/auth/login`, both in 60-second
 * windows:
 *   - Per-IP limit (default 5/min from `env.AUTH_LOGIN_RATE_IP_PER_MIN`).
 *   - Per-email limit (default 10/min from `env.AUTH_LOGIN_RATE_EMAIL_PER_MIN`).
 *
 * On block: throw `RateLimitError("Too many requests", "rate_limited")`
 * which the terminal error middleware renders as 429 + ProblemDetail.
 *
 * Storage: in-memory `MemoryStore` (the library default). PROMPT-0010 §6
 * documents this as a known v1 trade-off: limiter resets on process
 * restart. Redis backing is a future spec.
 *
 * Per-email keyer:
 *   We must NOT use the raw `email` body field — that lets an attacker
 *   poison a victim's bucket. Instead we use a normalised lowercased
 *   form. `EmailSchema` already lowercases on parse, but at the rate
 *   limit layer we run BEFORE the validator, so we lowercase here.
 *
 * Both limiters silently no-op on requests that don't carry a body
 * (e.g. preflight OPTIONS) — the validator catches malformed bodies
 * downstream.
 */

import type { Request, RequestHandler } from "express";
import rateLimit, { type Options } from "express-rate-limit";

import { RateLimitError } from "@facturador/utils/errors";

import { env } from "../env.js";

const WINDOW_MS = 60_000;

const baseOptions = (): Pick<
  Options,
  "windowMs" | "standardHeaders" | "legacyHeaders" | "validate" | "handler"
> => ({
  windowMs: WINDOW_MS,
  // `standardHeaders: true` emits RateLimit-* per draft-7. We never echo
  // Retry-After here; the ProblemDetail body carries everything the
  // client needs.
  standardHeaders: true,
  legacyHeaders: false,
  // The library does opportunistic IP validation; we keep it on so
  // misconfigured `trust proxy` settings throw loudly in dev.
  validate: { trustProxy: true, xForwardedForHeader: false },
  // Don't write to the response inside the handler — throw and let the
  // canonical error middleware build the ProblemDetail. The error
  // middleware uses `RateLimitError.code = "rate_limited"`, status 429.
  handler: (_req, _res, next) => {
    next(new RateLimitError());
  },
});

/**
 * Per-IP limiter. Keyed by the client IP that Express resolves (depends
 * on `trust proxy`). In tests Supertest connects via 127.0.0.1; in
 * production behind a proxy you MUST set `app.set("trust proxy", ...)`.
 */
export function buildLoginIpRateLimiter(): RequestHandler {
  return rateLimit({
    ...baseOptions(),
    max: env.AUTH_LOGIN_RATE_IP_PER_MIN,
  });
}

/**
 * Per-email limiter. Uses a custom keyer that lowercases the body's
 * `email` field. When the body is malformed or `email` is missing, we
 * fall back to keying by IP so we still throttle hostile traffic that
 * tries to flood the endpoint with garbage payloads.
 */
export function buildLoginEmailRateLimiter(): RequestHandler {
  return rateLimit({
    ...baseOptions(),
    max: env.AUTH_LOGIN_RATE_EMAIL_PER_MIN,
    keyGenerator: (req: Request) => {
      const body = req.body as { email?: unknown } | undefined;
      const raw = body?.email;
      if (typeof raw === "string" && raw.length > 0) {
        return `email:${raw.trim().toLowerCase()}`;
      }
      // Fallback so a request without `email` still consumes ONE slot
      // (using a sentinel key) and a hostile flood gets throttled too.
      return `email:_unknown_:${req.ip ?? "_no_ip_"}`;
    },
  });
}
