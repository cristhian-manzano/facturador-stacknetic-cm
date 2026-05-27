/**
 * `errorHandler` — Express 5 terminal error middleware.
 *
 * Per SPEC-0006 §6.6 + TASKS-0006 §3.2 + PROMPT-0006 hard constraints:
 *
 *   - MUST be the LAST middleware registered on the app.
 *   - Translates any thrown value to a `ProblemDetail` via
 *     `toProblemDetail` (which is pure + safe + redact-safe).
 *   - Logs at `error` level with the original error attached so the
 *     server-side stack stays observable (logger redaction guarantees no
 *     secrets in the line).
 *   - Sends the JSON body with the resolved status code.
 *
 * Important: this handler NEVER throws. `toProblemDetail` validates the
 * candidate body against `ProblemDetailSchema` and falls back to a
 * minimal 500 envelope if anything goes wrong.
 */
import type { ErrorRequestHandler } from "express";

import { toProblemDetail } from "@facturador/utils/errors";

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const problem = toProblemDetail(err, req.id);

  // Server-side log line (full err, redaction-aware). Never returned to client.
  if (req.log !== undefined) {
    req.log.error({ err, problem }, "request_error");
  }

  res.status(problem.status).json(problem);
};
