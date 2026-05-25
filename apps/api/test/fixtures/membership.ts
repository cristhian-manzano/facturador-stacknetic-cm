/**
 * `membershipFactory` — synthetic Membership fixture (TASKS-0007 §5.2).
 *
 * Defaults to role `OWNER` so a single fixture is enough for the typical
 * "tenant + single admin" test path.  Tests that exercise RBAC pass an
 * explicit `role` override.
 */
import type { Role } from "@facturador/contracts/auth";
import { MembershipSummarySchema, type MembershipSummary } from "@facturador/contracts/tenants";
import { newId } from "./_ids.js";

export interface MembershipFixture {
  id: string;
  userId: string;
  companyId: string;
  role: Role;
}

export interface MembershipFactoryInput {
  userId: string;
  companyId: string;
  role?: Role;
  id?: string;
}

export function membershipFactory(input: MembershipFactoryInput): MembershipFixture {
  return {
    id: input.id ?? newId(),
    userId: input.userId,
    companyId: input.companyId,
    role: input.role ?? "OWNER",
  };
}

/** Build a `MembershipSummary` that `MembershipSummarySchema.parse` accepts. */
export function membershipToSummary(m: MembershipFixture, razonSocial: string): MembershipSummary {
  return MembershipSummarySchema.parse({
    companyId: m.companyId,
    razonSocial,
    role: m.role,
  });
}
