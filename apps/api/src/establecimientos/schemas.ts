/**
 * Zod schemas for establecimiento + emission-point inputs.
 *
 * These are deliberately co-located with the handler rather than living in
 * `@facturador/contracts/billing` because they're server-only validators
 * (the SPA only reads the response shapes; the request shapes are not
 * exported across packages yet — pending SPEC-004x web wiring).
 *
 * Hard rules captured here:
 *   - `codigo` is exactly 3 decimal digits ([001..999]).
 *   - Bodies NEVER carry `companyId` — the server always derives it from
 *     `req.companyId` (populated by `requireTenant`). Schemas reject any
 *     attempt to inject one via `.strict()`.
 *   - String fields are trimmed and capped to defend against absurd
 *     payloads (`direccion` is 250 chars per SRI typical limit).
 */
import { z } from "zod";

/** Exactly 3 decimal digits, e.g. "001", "999". */
export const CodigoSchema = z.string().regex(/^\d{3}$/, "Codigo must be exactly 3 decimal digits");

export const CreateEstablecimientoSchema = z
  .object({
    codigo: CodigoSchema,
    direccion: z.string().trim().min(1).max(250),
    isMatriz: z.boolean().optional(),
  })
  .strict();
export type CreateEstablecimientoInput = z.infer<typeof CreateEstablecimientoSchema>;

export const UpdateEstablecimientoSchema = z
  .object({
    direccion: z.string().trim().min(1).max(250).optional(),
    isMatriz: z.boolean().optional(),
  })
  .strict();
export type UpdateEstablecimientoInput = z.infer<typeof UpdateEstablecimientoSchema>;

export const CreateEmissionPointSchema = z
  .object({
    codigo: CodigoSchema,
    descripcion: z.string().trim().min(1).max(250),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CreateEmissionPointInput = z.infer<typeof CreateEmissionPointSchema>;

export const UpdateEmissionPointSchema = z
  .object({
    descripcion: z.string().trim().min(1).max(250).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type UpdateEmissionPointInput = z.infer<typeof UpdateEmissionPointSchema>;
