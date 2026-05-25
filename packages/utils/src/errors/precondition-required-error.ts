/**
 * `PreconditionRequiredError` — 412 / `tenant_not_selected` (default).
 *
 * Used when a request reaches a tenant-scoped route without an active
 * tenant on the session (the user must first POST `/api/v1/session/tenant`).
 * Per TASKS-0011 §2.1 the response is a 412 with `code: "tenant_not_selected"`.
 *
 * 412 (Precondition Failed) is semantically the right status for "the client
 * has not satisfied a server-side precondition". HTTP 428 (Precondition
 * Required) is closer in spirit but is reserved by RFC 6585 for cases where
 * the SERVER asks the client to add headers like `If-Match`; we keep 412 as
 * the spec mandates.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class PreconditionRequiredError extends AppError {
  constructor(
    message = "No active tenant selected",
    code = "tenant_not_selected",
    options: AppErrorOptions = {},
  ) {
    super(message, 412, code, options);
  }
}
