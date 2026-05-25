/**
 * Tenant (Company) schemas.
 *
 * Per SPEC-0011 §FR-1/FR-2 and the SRI-flavored fields in
 * `docs/sri-facturacion-electronica-ecuador.md` §6 (`infoTributaria`).
 *
 * Cross-cutting note: contracts mirror the **API shape** of a tenant, NOT
 * the Prisma model. We deliberately omit columns like `passwordHash`,
 * timestamps used only by ORMs, etc.
 */
import { z } from "zod";
import { AmbienteSchema } from "../primitives/ambiente.js";
import { RucSchema } from "../primitives/ruc.js";
import { UlidSchema } from "../primitives/ulid.js";

export const TenantSchema = z.object({
  id: UlidSchema,
  ruc: RucSchema,
  razonSocial: z.string().min(1).max(300),
  nombreComercial: z.string().max(300).nullable(),
  direccionMatriz: z.string().min(1).max(300),
  ambiente: AmbienteSchema,
  contribuyenteEspecial: z.string().max(13).nullable(),
  obligadoContabilidad: z.boolean(),
  contribuyenteRimpe: z.string().max(300).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tenant = z.infer<typeof TenantSchema>;

/**
 * `CreateTenantSchema` — body for `POST /api/v1/tenants` (SPEC-0011 §FR-2).
 * Strict subset of `Tenant`: clients never send timestamps or an `id` (the
 * server mints a ULID).
 */
export const CreateTenantSchema = z.object({
  ruc: RucSchema,
  razonSocial: z.string().min(1).max(300),
  nombreComercial: z.string().max(300).optional(),
  direccionMatriz: z.string().min(1).max(300),
  ambiente: AmbienteSchema,
  contribuyenteEspecial: z.string().max(13).optional(),
  obligadoContabilidad: z.boolean(),
  contribuyenteRimpe: z.string().max(300).optional(),
});

export type CreateTenant = z.infer<typeof CreateTenantSchema>;

/**
 * `UpdateTenantSchema` — body for `PATCH /api/v1/tenants/:id`
 * (TASKS-0011 §3.4). All fields are optional but the body must not be
 * empty.
 *
 * Mutable surface is intentionally narrow:
 *   - `ruc` is NOT updatable (it's the fiscal identity; SRI rejects emission
 *     under a different RUC). Use a new tenant if a company changed its RUC.
 *   - `ambiente` and `tipoEmision` aren't updatable here either; those move
 *     through a dedicated emission-points workflow (later spec).
 */
export const UpdateTenantSchema = z
  .object({
    razonSocial: z.string().min(1).max(300).optional(),
    nombreComercial: z.string().max(300).nullable().optional(),
    direccionMatriz: z.string().min(1).max(300).optional(),
    contribuyenteEspecial: z.string().max(13).nullable().optional(),
    obligadoContabilidad: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "El body debe contener al menos un campo a actualizar",
  });

export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;
