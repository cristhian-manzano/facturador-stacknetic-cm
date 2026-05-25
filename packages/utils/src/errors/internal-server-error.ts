/**
 * `InternalServerError` — 500 / `internal.unexpected` (default).
 *
 * The error middleware coerces any unknown / non-`AppError` exception into
 * this class via `toProblemDetail`. The body NEVER contains stack traces or
 * raw error messages; those go to the server log only (SPEC-0006 §10).
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class InternalServerError extends AppError {
  constructor(
    message = "Internal Server Error",
    code = "internal.unexpected",
    options: AppErrorOptions = {},
  ) {
    super(message, 500, code, options);
  }
}
