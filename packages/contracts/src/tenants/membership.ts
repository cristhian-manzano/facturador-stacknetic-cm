/**
 * Tenant membership schemas.
 *
 * `MembershipSummarySchema` — what an auth response carries (just enough to
 * power the tenant switcher UI). Full membership management goes through
 * `MembershipSchema` (administrative operations under `tenants/`).
 *
 * Refs: SPEC-0010 §6.3 (login response shape), SPEC-0011 §6 (membership
 * model).
 */
import { z } from "zod";
import { UlidSchema } from "../primitives/ulid.js";
import { EmailSchema } from "../primitives/email.js";
import { RoleSchema } from "./role.js";

export const MembershipSummarySchema = z.object({
  companyId: UlidSchema,
  razonSocial: z.string().min(1).max(300),
  role: RoleSchema,
});

export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

export const MembershipSchema = z.object({
  id: UlidSchema,
  companyId: UlidSchema,
  userId: UlidSchema,
  role: RoleSchema,
  invitedByUserId: UlidSchema.nullable(),
  invitedEmail: EmailSchema.nullable(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Membership = z.infer<typeof MembershipSchema>;

/**
 * `MemberListItemSchema` — what `GET /api/v1/tenants/:id/members` returns
 * for each member row (TASKS-0011 §3.5).
 *
 * Includes the user's email + display name (for UI rendering) but never
 * password hash, last-login timestamps, or any other PII beyond what is
 * already on the membership list.
 */
export const MemberListItemSchema = z.object({
  userId: UlidSchema,
  email: EmailSchema,
  displayName: z.string().min(1).max(200),
  role: RoleSchema,
});

export type MemberListItem = z.infer<typeof MemberListItemSchema>;

/**
 * `AddMemberSchema` — body for `POST /api/v1/tenants/:id/members`
 * (TASKS-0011 §3.6). `userId` must refer to an existing user (out-of-band
 * — email-based invitations are a later spec).
 */
export const AddMemberSchema = z.object({
  userId: UlidSchema,
  role: RoleSchema,
});

export type AddMember = z.infer<typeof AddMemberSchema>;

/**
 * `UpdateMemberRoleSchema` — body for
 * `PATCH /api/v1/tenants/:id/members/:userId` (TASKS-0011 §3.7).
 */
export const UpdateMemberRoleSchema = z.object({
  role: RoleSchema,
});

export type UpdateMemberRole = z.infer<typeof UpdateMemberRoleSchema>;
