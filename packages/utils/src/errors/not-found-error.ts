/**
 * `NotFoundError` — 404.
 *
 * Code is derived from the resource name: e.g. passing
 * `new NotFoundError("invoice")` yields `code: "invoice.not_found"` per
 * SPEC-0006 §6.5. Callers can override the code if they need a more
 * specific namespace.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class NotFoundError extends AppError {
  constructor(resource: string, options: AppErrorOptions = {}, code?: string) {
    const safeResource = resource.trim().length > 0 ? resource : "resource";
    super(`${safeResource} not found`, 404, code ?? `${safeResource}.not_found`, options);
  }
}
