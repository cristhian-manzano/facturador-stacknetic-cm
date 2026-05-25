/**
 * `CustomerSchema` — discriminated union by `tipoIdentificacion` (SRI §9).
 *
 * Five branches per SPEC-0031 §FR-3:
 *
 *   - `"04"` RUC (sociedad or persona natural; both flavors validated by
 *      `RucSchema`).
 *   - `"05"` Cédula.
 *   - `"06"` Pasaporte.
 *   - `"07"` Consumidor final — `identificacion` MUST be `9999999999999`
 *      and `razonSocial` MUST be `"CONSUMIDOR FINAL"`.
 *   - `"08"` Identificación del exterior — lax 1–20 alphanumeric with
 *      common punctuation; we don't try to validate every foreign ID.
 *
 * Each branch shares a base of optional contact fields (email, telefono,
 * direccion, nombreComercial). PII fields are length-capped to defend
 * against unbounded-string DoS (SPEC-0005 §10).
 *
 * Refs: SPEC-0031, SPEC-0032 §6.4.
 */
import { z } from "zod";
import { CedulaSchema } from "../primitives/cedula.js";
import { EmailSchema } from "../primitives/email.js";
import { PasaporteSchema } from "../primitives/pasaporte.js";
import { RucSchema } from "../primitives/ruc.js";
import { UlidSchema } from "../primitives/ulid.js";

const ContactFields = z.object({
  razonSocial: z.string().min(1).max(300),
  nombreComercial: z.string().max(300).optional(),
  email: EmailSchema.optional(),
  telefono: z.string().max(40).optional(),
  direccion: z.string().max(300).optional(),
});

const RucCustomer = ContactFields.extend({
  tipoIdentificacion: z.literal("04"),
  identificacion: RucSchema,
});

const CedulaCustomer = ContactFields.extend({
  tipoIdentificacion: z.literal("05"),
  identificacion: CedulaSchema,
});

const PasaporteCustomer = ContactFields.extend({
  tipoIdentificacion: z.literal("06"),
  identificacion: PasaporteSchema,
});

const ConsumidorFinalCustomer = ContactFields.extend({
  tipoIdentificacion: z.literal("07"),
  identificacion: z.literal("9999999999999"),
  razonSocial: z.literal("CONSUMIDOR FINAL"),
});

const ExteriorCustomer = ContactFields.extend({
  tipoIdentificacion: z.literal("08"),
  identificacion: z
    .string()
    .min(1, "identificación del exterior es requerida")
    .max(20, "identificación del exterior excede 20 caracteres"),
});

/**
 * Full customer record returned by the API.
 *
 * `id`, `companyId`, `isActive` and timestamps are present here because the
 * API returns them; create/update payloads strip them via dedicated schemas.
 */
const TimestampFields = z.object({
  id: UlidSchema,
  companyId: UlidSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export const CustomerSchema = z.discriminatedUnion("tipoIdentificacion", [
  RucCustomer.merge(TimestampFields),
  CedulaCustomer.merge(TimestampFields),
  PasaporteCustomer.merge(TimestampFields),
  ConsumidorFinalCustomer.merge(TimestampFields),
  ExteriorCustomer.merge(TimestampFields),
]);

export type Customer = z.infer<typeof CustomerSchema>;

/**
 * Branch-only shape used by create / update endpoints. Exposed so other
 * schemas (e.g. invoice inline create) can re-use the same discrimination.
 */
export const CustomerInputSchema = z.discriminatedUnion("tipoIdentificacion", [
  RucCustomer,
  CedulaCustomer,
  PasaporteCustomer,
  ConsumidorFinalCustomer,
  ExteriorCustomer,
]);

export type CustomerInput = z.infer<typeof CustomerInputSchema>;
