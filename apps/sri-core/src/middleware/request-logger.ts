/**
 * `requestLoggerMiddleware` — bind a child Pino logger to the request.
 *
 * Per SPEC-0006 §6.4. Runs AFTER `requestIdMiddleware` so the child carries
 * the correlation id. Listens for `res.on("finish")` to emit an `info`
 * line with method/path/status/durationMs — a baseline access log that
 * already benefits from the global redaction list.
 *
 * Mirror of `apps/api/src/middleware/request-logger.ts`.
 */
import type { RequestHandler } from "express";
import { withRequest, type Logger } from "@facturador/logger";

export const createRequestLogger = (rootLogger: Logger): RequestHandler => {
  return (req, res, next) => {
    // `withRequest` accepts a `RequestLike` with an optional id. With
    // `exactOptionalPropertyTypes`, we can't pass `{ id: req.id }` when
    // `req.id` is potentially `undefined`. Build the object conditionally.
    const child = withRequest(rootLogger, req.id === undefined ? {} : { id: req.id });
    req.log = child;

    const start = Date.now();
    res.on("finish", () => {
      child.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        "request",
      );
    });
    next();
  };
};
