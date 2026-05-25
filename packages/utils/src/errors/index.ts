/**
 * Subpath: `@facturador/utils/errors`.
 *
 * Re-exports the `AppError` base class, every concrete subclass, and the
 * `toProblemDetail` adapter. Consumers should depend on the subpath rather
 * than the package barrel to keep tree-shaking effective.
 */
export { AppError, type AppErrorOptions } from "./app-error.js";
export { ValidationError } from "./validation-error.js";
export { AuthError } from "./auth-error.js";
export { ForbiddenError } from "./forbidden-error.js";
export { NotFoundError } from "./not-found-error.js";
export { ConflictError } from "./conflict-error.js";
export { PreconditionRequiredError } from "./precondition-required-error.js";
export { RateLimitError } from "./rate-limit-error.js";
export { UpstreamError } from "./upstream-error.js";
export { BusinessError } from "./business-error.js";
export { InternalServerError } from "./internal-server-error.js";
export { toProblemDetail } from "./to-problem-detail.js";
