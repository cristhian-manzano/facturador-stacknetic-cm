/**
 * Per-tenant rate limiter for `POST /v1/documents/*`.
 *
 * Source of truth:
 *   - audit-punchlist Item 2 / REVIEW-0020 §10 #3 / REVIEW-0020 §11 #3.
 *
 * Behaviour:
 *   - Window: 60 s.
 *   - Cap: 100 requests / window / `companyId` (override via `max`).
 *   - Keys by `req.service.companyId` — the JWT `sub` is the only
 *     trustworthy tenant scope inside sri-core. Falls back to the IP for
 *     requests that bypass `requireServiceJwt` (defence in depth — they
 *     should never reach here in practice).
 *   - Skips non-POST methods (the punchlist scope is mutating routes only).
 *   - On block: throws `RateLimitError("Too many requests", "auth.rate_limited")`
 *     which the terminal error middleware renders as 429 + ProblemDetail.
 *
 * Production note: the underlying store is in-memory; multi-replica
 * deployments need a Redis-backed store to be effective across pods.
 */
import type { Request, RequestHandler } from "express";
import rateLimit, { type Options } from "express-rate-limit";

import { RateLimitError } from "@facturador/utils/errors";

/** Sentinel code surfaced on the wire when the cap is exceeded. */
export const SRI_DOCUMENTS_RATE_LIMITED_CODE = "auth.rate_limited";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 100;

export interface BuildDocumentsRateLimiterOptions {
  /** Per-window cap. Default 100. */
  readonly max?: number;
  /** Window length in ms. Default 60 000. */
  readonly windowMs?: number;
}

/**
 * Build the per-tenant rate limiter. Tests pass tiny `max` so they can
 * exercise the block path without spinning up 100 requests; production
 * defaults match the audit punchlist.
 */
export function buildDocumentsRateLimiter(
  options: BuildDocumentsRateLimiterOptions = {},
): RequestHandler {
  const baseOptions: Partial<Options> = {
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    max: options.max ?? DEFAULT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // Validate sane defaults; we don't trust X-Forwarded-For here.
    validate: { trustProxy: true, xForwardedForHeader: false },
    handler: (_req, _res, next) => {
      next(new RateLimitError("Too many requests", SRI_DOCUMENTS_RATE_LIMITED_CODE));
    },
    // We deliberately key by the verified service-JWT `companyId` — the
    // IP is operator-controlled in production (reverse proxy) so it's a
    // poor tenant identifier. When the service stamp is missing we fall
    // back to the IP so a malformed request still consumes a slot.
    keyGenerator: (req: Request) => {
      const companyId = req.service?.companyId;
      if (typeof companyId === "string" && companyId.length > 0) {
        return `companyId:${companyId}`;
      }
      return `ip:${req.ip ?? "_no_ip_"}`;
    },
    skip: (req: Request) => req.method !== "POST",
  };
  return rateLimit(baseOptions);
}
