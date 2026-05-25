/**
 * `ForbiddenError` — 403 / `tenant.forbidden` (default).
 *
 * A correct user on the wrong tenant; or any operation outside the caller's
 * RBAC. The default code is `tenant.forbidden` because multi-tenant guards
 * are the most common consumer (see SPEC-0011); callers can override the
 * code (e.g. `cert.forbidden`).
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "tenant.forbidden", options: AppErrorOptions = {}) {
    super(message, 403, code, options);
  }
}
