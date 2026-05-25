/**
 * `requestIdMiddleware` — ensure every request carries an `X-Request-Id`.
 *
 * Per SPEC-0006 §FR-4 + §6.4 + TASKS-0006 §3.1:
 *   - Honour the inbound `x-request-id` header if it matches the ULID
 *     shape (26 chars, Crockford alphabet, case-insensitive).
 *   - Otherwise generate a fresh ULID.
 *   - Echo the resolved id back on the response header so the client can
 *     correlate. Also stamp `req.id` for downstream middleware/handlers.
 */
import type { RequestHandler } from "express";
import { ulid } from "ulid";

const ULID_RE = /^[0-9A-Z]{26}$/i;

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id = incoming !== undefined && ULID_RE.test(incoming) ? incoming : ulid();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
};
