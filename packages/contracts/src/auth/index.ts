/**
 * Subpath: `@facturador/contracts/auth`.
 *
 * Login, "me", and tenant-switch shapes. Re-exports the `RoleSchema` and
 * `MembershipSummarySchema` because they are part of the login response
 * surface (consumers don't need a second import).
 */
export {
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
  type UserPublic,
} from "./login.js";
export { SessionTenantSwitchSchema, type SessionTenantSwitch } from "./session.js";
export { MembershipSummarySchema, type MembershipSummary } from "../tenants/membership.js";
export { RoleSchema, type Role } from "../tenants/role.js";
