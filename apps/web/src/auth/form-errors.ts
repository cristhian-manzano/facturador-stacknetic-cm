/**
 * `mapProblemErrorsToForm` — bridge between `ApiError.problem.errors[]` and
 * React Hook Form's `setError`.
 *
 * Source of truth:
 *   - PROMPT-0041 §4 — "Error mapping from `ApiError.problem.errors[]` to
 *     RHF `setError` is centralised in a helper".
 *   - TASKS-0041 §1.1 — login form maps inline field errors from `problem.errors`.
 *
 * Contract:
 *   - The API returns 400 with a `ProblemDetail` whose `errors[]` is a list
 *     of `SriMensaje { identificador, mensaje, tipo, informacionAdicional? }`.
 *   - For form mapping, `identificador` is the **field name** (e.g. `email`,
 *     `password`). The server uses Spanish field names that match the
 *     form's `register("<name>")` keys. Unknown identifiers fall under
 *     `setRootError` (RHF's "root" namespace) so the user still sees them.
 *
 * Why centralised?
 *   - Two forms (login now, factura form in SPEC-0042 next) need the same
 *     conversion. Drift between them would leak inconsistencies (one form
 *     swallowing root errors, another double-displaying them).
 *   - Lets tests assert the conversion once.
 *
 * Caveat:
 *   - Only `tipo === "ERROR"` rows are mapped to form errors. `ADVERTENCIA`
 *     / `INFORMATIVO` rows are returned in the same envelope; consumers
 *     who want to surface those should pass `includeWarnings: true`. The
 *     login form does NOT — warnings on a login attempt are nonsensical.
 */
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { SriMensaje } from "@facturador/contracts/sri";

export interface MapProblemErrorsOptions {
  /**
   * Map of identifier → form field name. When provided, identifiers that
   * appear in this map are translated to the form field. Identifiers that
   * aren't in the map and don't match a form field directly become `root`
   * errors.
   *
   * Example: `{ "email": "email", "password": "password" }` (login),
   * `{ "razonSocial": "razonSocial" }` (settings form).
   */
  fieldMap?: Readonly<Record<string, string>>;
  /** Include non-ERROR rows in the mapping (default: false). */
  includeWarnings?: boolean;
}

/**
 * Map a list of `SriMensaje` entries onto a React Hook Form via `setError`.
 *
 * Returns the number of messages mapped to fields. Root-level messages are
 * counted too.
 */
export function mapProblemErrorsToForm<TValues extends FieldValues>(
  setError: UseFormSetError<TValues>,
  errors: readonly SriMensaje[] | undefined,
  options: MapProblemErrorsOptions = {},
): number {
  if (errors === undefined || errors.length === 0) return 0;
  const { fieldMap, includeWarnings = false } = options;
  let mapped = 0;

  for (const msg of errors) {
    if (!includeWarnings && msg.tipo !== "ERROR") continue;
    const candidate = fieldMap?.[msg.identificador] ?? msg.identificador;
    if (candidate.length === 0) {
      setError("root" as Path<TValues>, { type: "server", message: msg.mensaje });
      mapped += 1;
      continue;
    }
    setError(candidate as Path<TValues>, {
      type: "server",
      message: msg.mensaje,
    });
    mapped += 1;
  }
  return mapped;
}
