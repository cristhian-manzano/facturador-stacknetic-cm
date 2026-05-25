/**
 * `RateLimitError` — 429 / `rate_limited` (default).
 *
 * Thrown by future throttle middleware (login, SRI calls, etc.). Reserve
 * a slot in the hierarchy here so consumers can rely on the (status, code)
 * mapping today.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class RateLimitError extends AppError {
  constructor(message = "Too many requests", code = "rate_limited", options: AppErrorOptions = {}) {
    super(message, 429, code, options);
  }
}
