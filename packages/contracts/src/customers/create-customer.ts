/**
 * `CreateCustomerSchema` — body for `POST /api/v1/customers` (SPEC-0031 §FR-3).
 *
 * Derived from the customer input union; this re-export keeps the public
 * subpath stable even if the underlying shape evolves.
 */
import type { z } from "zod";

import { CustomerInputSchema } from "./customer.js";

export const CreateCustomerSchema = CustomerInputSchema;

export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;
