/**
 * Request validators — `validateBody` / `validateQuery` / `validateParams`.
 *
 * Per SPEC-0006 §6.6 + TASKS-0006 §3.3:
 *
 *   - Each runs `schema.safeParse(...)` on the relevant request slice.
 *   - On failure: throw `ValidationError` with `errors` populated from
 *     `result.error.issues`, ordered deterministically by `path` then
 *     `message` so tests are stable.
 *   - On success: assign the parsed value back to the request so handlers
 *     consume the typed, transformed shape (e.g. lowercased emails).
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const value: unknown = (req as any)[slice];
    const result = schema.safeParse(value);
    if (!result.success) {
      next(
        new ValidationError(`Invalid request ${slice}`, {
          errors: issuesToMensajes(slice, result.error.issues),
        }),
      );
      return;
    }
    // Re-assign the parsed (possibly transformed) value back to the request.
    assignSlice(req, slice, result.data as unknown);
    next();
  };

function assignSlice(req: Request, slice: RequestSlice, value: unknown): void {
  // Express 5 makes `req.query` a getter; mutating it directly works but
  // TypeScript flags it as readonly. Cast through `Record<string, unknown>`
  // for the assignment without disabling strict rules elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any)[slice] = value;
}

export const validateBody = <T>(schema: ZodSchema<T>): RequestHandler => build("body", schema);
export const validateQuery = <T>(schema: ZodSchema<T>): RequestHandler => build("query", schema);
export const validateParams = <T>(schema: ZodSchema<T>): RequestHandler => build("params", schema);
