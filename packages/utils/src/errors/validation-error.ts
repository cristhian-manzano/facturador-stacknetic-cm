/**
 * `ValidationError` — 400 / `validation.failed`.
 *
 * Used by the request body/query/params validator (apps/api + apps/sri-core)
 * to surface Zod failures as a `ProblemDetail.errors[]` list. Each issue
 * becomes a `SriMensaje` whose `identificador` is the dotted path of the
 * offending field. See SPEC-0006 §6.6 and TASKS-0006 §3.3.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options: AppErrorOptions = {}) {
    super(message, 400, "validation.failed", options);
  }
}
