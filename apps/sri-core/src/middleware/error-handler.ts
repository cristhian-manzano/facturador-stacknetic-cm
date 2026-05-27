/**
 * `errorHandler` — Express 5 terminal error middleware for apps/sri-core.
 *
 * Per SPEC-0006 §6.6 + TASKS-0006 §3.2 / §3.4 + PROMPT-0006 hard
 * constraints:
 *
 *   - MUST be the LAST middleware registered on the app.
 *   - Translates any thrown value to a `ProblemDetail` via
 *     `toProblemDetail` (which is pure + safe + redact-safe).
 *   - Logs at `error` level with the original error attached so the
 *     server-side stack stays observable (logger redaction guarantees no
 *     secrets in the line).
 *   - Sends the JSON body with the resolved status code.
 *
 * Mirror of `apps/api/src/middleware/error-handler.ts`.
 */
import type { ErrorRequestHandler } from "express";

import { toProblemDetail } from "@facturador/utils/errors";

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const problem = toProblemDetail(err, req.id);

  if (req.log !== undefined) {
    req.log.error({ err, problem }, "request_error");
  }

  res.status(problem.status).json(problem);
};
