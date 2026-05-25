/**
 * Customer validation layer (SPEC-0031 §FR-3 / TASKS-0031 §2).
 *
 * Two responsibilities:
 *
 *   1. **Defence-in-depth.** Parse incoming POST / PATCH bodies through the
 *      shared Zod schemas (`@facturador/contracts/customers`). The discriminated
 *      union already enforces per-branch identification checksums (RUC módulo
 *      11 via `RucSchema`, cédula módulo 10 via `CedulaSchema`, pasaporte
 *      regex, the literal `9999999999999` for consumidor final, and lax 1..20
 *      for exterior).
 *
 *   2. **Per-branch business rules.** SPEC-0031 §6.3 / FR-3 dictates that
 *      `direccion` is mandatory for the locally-identified branches (04/05/06)
 *      but optional for consumidor final (07). Exterior (08) is also free to
 *      omit `direccion` because we cannot enforce a foreign-address shape.
 *      The contracts package leaves `direccion` optional across all branches
 *      so the API can produce a clean per-field error; that's what
 *      `validateCreate` does here.
 *
 * Hard rules captured here:
 *
 *   - `companyId` is NEVER read from the body. The contracts schema rejects
 *     extra keys (well — Zod's default is to strip them). The server always
 *     derives the active tenant from `req.companyId`.
 *
 *   - The 07 / 9999999999999 row is reserved for the `ensureConsumidorFinal`
 *     helper. The API rejects manual POSTs to the regular `/customers` route
 *     with the fixed identifier (returns ConflictError with code
 *     `customer.use_helper`). We assert that here so the rejection happens
 *     before we hit the DB unique constraint.
 *
 *   - Update payloads cannot change `tipoIdentificacion` or `identificacion`
 *     (would break invoice traceability). The contracts `UpdateCustomerSchema`
 *     intentionally omits both fields; we re-state the rule with a 422
 *     `BusinessError` if a client somehow snuck a `tipoIdentificacion` key in.
 */
import type { z } from "zod";
import {
  CreateCustomerSchema,
  type CreateCustomer,
  UpdateCustomerSchema,
  type UpdateCustomer,
} from "@facturador/contracts/customers";
import { BusinessError, ConflictError, ValidationError } from "@facturador/utils/errors";

/**
 * The fixed Consumidor Final identifier. Centralised here so a typo never
 * breaks the guard. Mirrors the literal in the contracts package.
 */
export const CONSUMIDOR_FINAL_IDENTIFICACION = "9999999999999";
export const CONSUMIDOR_FINAL_RAZON_SOCIAL = "CONSUMIDOR FINAL";
export const CONSUMIDOR_FINAL_TIPO_IDENTIFICACION = "07";

/**
 * Strict parse + per-branch refinement for `POST /api/v1/customers`. Throws
 * `ValidationError` on shape problems and `ConflictError` for the
 * use-the-helper rule. The result is the fully-validated body ready to insert.
 */
export function validateCreate(input: unknown): CreateCustomer {
  const parsed = CreateCustomerSchema.safeParse(input);
  if (!parsed.success) {
    throw zodToValidationError(parsed.error);
  }
  const body = parsed.data;

  // -- Defence-in-depth: per-branch required-field rules. --------------
  //
  // The discriminated union in `@facturador/contracts/customers` already
  // enforces the *identification* checksum per branch. What it does NOT
  // enforce (and SPEC-0031 §6.3 requires) is that `direccion` is mandatory
  // for the locally-identified branches.
  if (
    (body.tipoIdentificacion === "04" ||
      body.tipoIdentificacion === "05" ||
      body.tipoIdentificacion === "06") &&
    (body.direccion === undefined || body.direccion.trim().length === 0)
  ) {
    throw new BusinessError(
      "direccion is required for this tipoIdentificacion",
      "customer.direccion_required",
      {
        errors: [
          {
            identificador: "direccion",
            mensaje: "direccion es requerida para este tipo de identificación",
            tipo: "ERROR",
          },
        ],
      },
    );
  }

  // -- Hard rule: manual creation of the Consumidor Final row is rejected.
  //
  // The unique index `(companyId, tipoIdentificacion, identificacion)` already
  // produces a 409 on the second POST, but the first POST would silently
  // create the row outside the helper — and `ensureConsumidorFinal` would
  // then collide. Rejecting up front gives a deterministic 409 with a
  // recognisable code (`customer.use_helper`).
  //
  // Note: the contracts schema pins `identificacion` to the literal
  // `"9999999999999"` for the `"07"` branch, so checking the
  // `tipoIdentificacion` here is sufficient — the literal-id check would be
  // tautological after Zod validation.
  if (body.tipoIdentificacion === CONSUMIDOR_FINAL_TIPO_IDENTIFICACION) {
    throw new ConflictError(
      "Consumidor Final row must be created via ensureConsumidorFinal()",
      "customer.use_helper",
    );
  }

  return body;
}

/**
 * Strict parse for `PATCH /api/v1/customers/:id`. The contracts schema
 * intentionally drops `tipoIdentificacion` / `identificacion` so they can
 * never be updated; we re-state the rule with a 422 if a client tries to
 * sneak one in (Zod would silently drop them, but a defensive check makes
 * the intent obvious to any reviewer and produces a clear error message).
 */
export function validateUpdate(input: unknown): UpdateCustomer {
  // First, reject any explicit attempt to change immutable identity fields.
  // We probe the raw input before letting Zod strip them.
  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    if ("tipoIdentificacion" in raw || "identificacion" in raw) {
      const offender = "tipoIdentificacion" in raw ? "tipoIdentificacion" : "identificacion";
      throw new BusinessError(
        "tipoIdentificacion and identificacion cannot be modified",
        "customer.immutable_field",
        {
          errors: [
            {
              identificador: offender,
              mensaje: "tipoIdentificacion / identificacion no pueden modificarse",
              tipo: "ERROR",
            },
          ],
        },
      );
    }
  }

  const parsed = UpdateCustomerSchema.safeParse(input);
  if (!parsed.success) {
    throw zodToValidationError(parsed.error);
  }
  return parsed.data;
}

/**
 * Helper: convert a `ZodError` into the project's `ValidationError`.
 *
 * `ValidationError.code` is always `validation.failed` per SPEC-0006 §6.7;
 * the per-field details land in `errors[]` so the front-end can pin-point the
 * offending field.
 */
function zodToValidationError(zerr: z.ZodError): ValidationError {
  const items = zerr.issues.map((issue) => ({
    identificador: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    mensaje: issue.message,
    tipo: "ERROR" as const,
  }));
  return new ValidationError("Customer payload validation failed", {
    errors: items,
  });
}
