/**
 * `UpdateCustomerSchema` — body for `PATCH /api/v1/customers/:id`.
 *
 * Per SPEC-0031: clients cannot change `tipoIdentificacion` or
 * `identificacion` of a customer (would break invoice traceability). All
 * other contact fields are optional.
 */
import { z } from "zod";
import { EmailSchema } from "../primitives/email.js";

export const UpdateCustomerSchema = z
  .object({
    razonSocial: z.string().min(1).max(300).optional(),
    nombreComercial: z.string().max(300).optional(),
    email: EmailSchema.optional(),
    telefono: z.string().max(40).optional(),
    direccion: z.string().max(300).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "update payload must contain at least one field",
  });

export type UpdateCustomer = z.infer<typeof UpdateCustomerSchema>;
