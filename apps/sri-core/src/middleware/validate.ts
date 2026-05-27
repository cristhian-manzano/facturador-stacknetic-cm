/**
 * Request validators — `validateBody` / `validateQuery` / `validateParams`.
 *
 * Per SPEC-0006 §6.6 + TASKS-0006 §3.3 / §3.4. Mirror of
 * `apps/api/src/middleware/validate.ts`:
 *
 *   - Each runs `schema.safeParse(...)` on the relevant request slice.
 *   - On failure: throw `ValidationError` with `errors` populated from
 *     `result.error.issues`, ordered deterministically by `path` then
 *     `message` so tests are stable.
 *   - On success: assign the parsed value back to the request so handlers
 *     consume the typed, transformed shape.
 *
 * The validator does NOT swallow the error — it lets the Express error
 * middleware translate it to a `ProblemDetail`.
 */
import type { Request, RequestHandler } from "express";
import type { ZodSchema } from "zod";

import type { SriMensaje } from "@facturador/contracts/errors";
import { ValidationError } from "@facturador/utils/errors";

type RequestSlice = "body" | "query" | "params";

const MENSAJE_MAX = 1000;
const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const issuesToMensajes = (
  slice: RequestSlice,
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): SriMensaje[] => {
  const sorted = [...issues].sort((a, b) => {
    const pa = a.path.join(".");
    const pb = b.path.join(".");
    if (pa === pb) return a.message.localeCompare(b.message);
    return pa.localeCompare(pb);
  });
  return sorted.map((issue) => {
    const path = issue.path.join(".");
    const identificador = path.length === 0 ? slice : path;
    return {
      identificador: truncate(identificador, 20),
      mensaje: truncate(issue.message, MENSAJE_MAX),
      tipo: "ERROR" as const,
    };
  });
};

const build =
  <T>(slice: RequestSlice, schema: ZodSchema<T>): RequestHandler =>
  (req, _res, next) => {
    const value: unknown = (req as unknown as Record<RequestSlice, unknown>)[slice];
    const result = schema.safeParse(value);
    if (!result.success) {
      next(
        new ValidationError(`Invalid request ${slice}`, {
          errors: issuesToMensajes(slice, result.error.issues),
        }),
      );
      return;
    }
    assignSlice(req, slice, result.data as unknown);
    next();
  };

function assignSlice(req: Request, slice: RequestSlice, value: unknown): void {
  // Express 5 makes `req.query` a getter; mutate via a writable record cast.
  (req as unknown as Record<RequestSlice, unknown>)[slice] = value;
}

export const validateBody = <T>(schema: ZodSchema<T>): RequestHandler => build("body", schema);
export const validateQuery = <T>(schema: ZodSchema<T>): RequestHandler => build("query", schema);
export const validateParams = <T>(schema: ZodSchema<T>): RequestHandler => build("params", schema);
