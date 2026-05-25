/**
 * Login schemas — `LoginRequest`, `LoginResponse`, `MeResponse`.
 *
 * Per SPEC-0010 §6.3 (login handler) and SPEC-0005 §6.5.
 *
 * Security notes (PROMPT-0005 §6):
 *   - `password` is input-only; no response in this package echoes it.
 *   - `email` is lowercased on parse via `EmailSchema`. The raw form never
 *     leaves this layer.
 *   - `LoginResponse.csrfToken` is intentionally surfaced so the Web layer
 *     can echo it in the `x-csrf-token` header — the cookie + header
 *     double-submit pattern documented in SPEC-0010 §FR-5.
 */
import { z } from "zod";
import { EmailSchema } from "../primitives/email.js";
import { UlidSchema } from "../primitives/ulid.js";
import { MembershipSummarySchema } from "../tenants/membership.js";

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  // Password length capped per SPEC-0005 §10 (DoS protection).
  password: z.string().min(8, "password debe tener mínimo 8 caracteres").max(72),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

const UserPublicSchema = z.object({
  id: UlidSchema,
  email: EmailSchema,
  displayName: z.string().min(1).max(200),
});

export type UserPublic = z.infer<typeof UserPublicSchema>;

export const LoginResponseSchema = z.object({
  user: UserPublicSchema,
  memberships: z.array(MembershipSummarySchema),
  activeCompanyId: UlidSchema.nullable(),
  csrfToken: z.string().min(1),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * `MeResponseSchema` — current user + memberships + tenant context.
 *
 * Per SPEC-0011 §FR-5 + TASKS-0011 §4.1, the response carries enough state
 * for the SPA to render the dashboard:
 *   - `user` — id, email, displayName.
 *   - `memberships` — the full list of (company, role) pairs the user has.
 *   - `activeCompanyId` — the active tenant from `Session.companyId`. Null
 *     until the user picks one via `POST /api/v1/session/tenant`.
 *   - `currentRole` — caller's role on the active tenant (null if no active
 *     tenant). Derived server-side from the membership row.
 *   - `permissions` — list of `Action` strings the current role may perform
 *     (per the matrix in `@facturador/utils/rbac`). Empty list when no
 *     active tenant. Used by the SPA for UI hints; server is still the
 *     authority on enforcement.
 *
 * The `csrfToken` is NOT in `me` because it rotates only on login + tenant
 * switch. Clients keep the latest value from the cookie / login body.
 */
export const MeResponseSchema = z.object({
  user: UserPublicSchema,
  memberships: z.array(MembershipSummarySchema),
  activeCompanyId: UlidSchema.nullable(),
  currentRole: z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"]).nullable(),
  permissions: z.array(z.string()),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
