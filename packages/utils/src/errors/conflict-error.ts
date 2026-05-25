/**
 * `ConflictError` — 409 / `conflict` (default).
 *
 * For idempotency conflicts, duplicate `claveAcceso`, secuencial gaps, etc.
 * Callers typically pass a domain-specific code such as
 * `invoice.duplicate_clave`.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "conflict", options: AppErrorOptions = {}) {
    super(message, 409, code, options);
  }
}
