/**
 * `RoleSchema` — exhaustive list of tenant roles in the RBAC matrix.
 *
 * Mirrors the Prisma `Role` enum (SPEC-0004) and the permission matrix in
 * SPEC-0011 §6.2. Defined under `tenants/` because the role is a property
 * of a tenant membership, not of the user.
 *
 * Auth responses also surface roles (see `MembershipSummarySchema`), so the
 * auth subpath re-exports this type.
 */
import { z } from "zod";

export const RoleSchema = z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"]);

export type Role = z.infer<typeof RoleSchema>;
