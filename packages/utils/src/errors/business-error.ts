/**
 * `BusinessError` — 422 / `business_rule_violation` (default).
 *
 * For domain-rule failures detected before persistence (totals mismatch,
 * unsupported `tipoIdentificacion` × `tipoEmision` combo, ...). Callers
 * pass a domain-specific code like `invoice.totals_mismatch`.
 */
import { AppError, type AppErrorOptions } from "./app-error.js";

export class BusinessError extends AppError {
  constructor(
    message = "Business rule violation",
    code = "business_rule_violation",
    options: AppErrorOptions = {},
  ) {
    super(message, 422, code, options);
  }
}
