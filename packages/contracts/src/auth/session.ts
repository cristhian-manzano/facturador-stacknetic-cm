/**
 * Session-related schemas.
 *
 * `SessionTenantSwitchSchema` — body of `POST /api/v1/session/tenant`
 * (SPEC-0011 §FR-3). The server validates that the caller is an active
 * member of `companyId` and rotates the CSRF cookie.
 */
import { z } from "zod";

import { UlidSchema } from "../primitives/ulid.js";

export const SessionTenantSwitchSchema = z.object({
  companyId: UlidSchema,
});

export type SessionTenantSwitch = z.infer<typeof SessionTenantSwitchSchema>;
