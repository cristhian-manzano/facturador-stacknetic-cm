/**
 * `ProblemDetailSchema` — RFC 7807-ish error envelope used by every API.
 *
 * Per TASKS-0005 §8.1 (authoritative shape) + SPEC-0006 §6.6 (error
 * middleware) + PROMPT-0005 §6 (security):
 *
 *   - `errors` carries an array of `SriMensaje` — sanitised at the API
 *     boundary before serialisation. No raw SRI XML, no stack traces.
 *   - `type` is optional and, when present, is either a `urn:` or a URL.
 *   - `code` is the snake-case machine-readable error code (taxonomy
 *     enumerated in SPEC-0006 §6.7).
 *   - `status` is the HTTP status (100..599).
 *
 * Deliberate omission: there is NO field for stack traces or original
 * exception objects. Logging those is the logger's job (SPEC-0006 §6.3
 * redactions) and they NEVER reach this schema.
 */
import { z } from "zod";
import { SriMensajeSchema } from "../sri/mensaje.js";

export const ProblemDetailSchema = z.object({
  type: z.string().min(1).max(2048).optional(),
  title: z.string().min(1).max(300),
  status: z.number().int().gte(100).lt(600),
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, "code debe ser snake_case con namespaces"),
  detail: z.string().max(2000).optional(),
  instance: z.string().max(300).optional(),
  errors: z.array(SriMensajeSchema).optional(),
});

export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;
