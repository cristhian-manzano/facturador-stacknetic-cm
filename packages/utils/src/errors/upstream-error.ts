/**
 * `UpstreamError` — 502 / `upstream_failure` (default).
 *
 * For SRI calls that timed out, returned malformed XML, or surfaced a 5xx.
 * Callers typically pass `sri.network` or `sri.config`. The original cause
 * is forwarded via `Error.cause` for server-side debugging; never include
 * cause data in `detail` (it may contain third-party URLs — SPEC-0006 §10).
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class UpstreamError extends AppError {
  constructor(
    message = "Upstream service failure",
    code = "upstream_failure",
    options: AppErrorOptions = {},
  ) {
    super(message, 502, code, options);
  }
}
