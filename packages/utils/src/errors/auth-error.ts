/**
 * `AuthError` — 401 / `auth.unauthenticated` (default).
 *
 * Auth handlers must never reveal whether a user/email exists. Use the same
 * message for "unknown user" and "bad password". See SPEC-0006 §10 and
 * ai/context/security.md.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class AuthError extends AppError {
  constructor(
    message = "Authentication required",
    code = "auth.unauthenticated",
    options: AppErrorOptions = {},
  ) {
    super(message, 401, code, options);
  }
}
