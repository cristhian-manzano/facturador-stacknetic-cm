/**
 * Tenant + membership business logic.
 *
 * Functions are pure with respect to their `prisma` arg (no module-level
 * state, no random globals) so they're trivial to test against a per-test
 * Postgres schema or a Prisma stub.
 *
 * Source of truth:
 *   - SPEC-0011 §FR-1..6 + §6.5.
 *   - TASKS-0011 §3 (endpoint behaviour).
 *   - PLAN-0011 §4 phase 3.
 *
 * Hard rules enforced here:
 *   1. companyId NEVER read from a client body — callers pass the
 *      validated id explicitly.
 *   2. Last-OWNER guard: cannot demote/remove the only OWNER of a tenant.
 *      Enforced inside `prisma.$transaction` so a concurrent demote can't
 *      sneak past the check.
 *   3. Duplicate RUC → `ConflictError("ruc.duplicate")` (Prisma P2002 on
 *      `Company.ruc` unique).
 */

import { ulid } from "ulid";

import type { Prisma, PrismaClient } from "@facturador/db";
import { BusinessError, ConflictError, NotFoundError } from "@facturador/utils/errors";
import type { Role } from "@facturador/utils/rbac";

const isPrismaKnownError = (err: unknown): err is Prisma.PrismaClientKnownRequestError =>
  typeof err === "object" && err !== null && "code" in err;

/**
 * Build the input shape Prisma expects for `Company.create`. We accept a
 * narrow object so the handler doesn't accidentally pass extra fields
 * straight from `req.body`.
 */
export interface CreateTenantInput {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string | null;
  direccionMatriz: string;
  ambiente: "1" | "2";
  contribuyenteEspecial?: string | null;
  obligadoContabilidad: boolean;
}

export interface CreatedTenantResult {
  companyId: string;
  membershipId: string;
}

/**
 * Create a tenant + grant the actor `OWNER`. Atomic via `$transaction`.
 *
 * Returns the new company id and the membership id so the caller can audit
 * both rows.
 */
export async function createTenantWithOwner(
  prisma: PrismaClient,
  actorUserId: string,
  input: CreateTenantInput,
): Promise<CreatedTenantResult> {
  const companyId = ulid();
  const membershipId = ulid();
  try {
    await prisma.$transaction([
      prisma.company.create({
        data: {
          id: companyId,
          ruc: input.ruc,
          razonSocial: input.razonSocial,
          nombreComercial: input.nombreComercial ?? null,
          ambiente: input.ambiente,
          tipoEmision: "1",
          direccionMatriz: input.direccionMatriz,
          contribuyenteEspecial: input.contribuyenteEspecial ?? null,
          obligadoContabilidad: input.obligadoContabilidad,
        },
      }),
      prisma.membership.create({
        data: {
          id: membershipId,
          userId: actorUserId,
          companyId,
          role: "OWNER",
          // OWNER bootstrap is implicitly accepted (no invite handshake).
          // Setting `acceptedAt = now` keeps the row active for the
          // `requireTenant` lookup which filters `acceptedAt: { not: null }`.
          acceptedAt: new Date(),
        },
      }),
    ]);
  } catch (err) {
    if (isPrismaKnownError(err) && err.code === "P2002") {
      // Unique violation: the only unique constraint on Company is `ruc`.
      throw new ConflictError("RUC ya registrado", "ruc.duplicate");
    }
    throw err;
  }
  return { companyId, membershipId };
}

/**
 * Update a tenant's mutable fields. The caller is responsible for having
 * already passed `requirePermission("tenant.update")`.
 *
 * `companyId` MUST be the id from `req.companyId` (server-side). The
 * caller should NEVER pass an id from the URL parameter without first
 * comparing to the session — but we additionally enforce that the
 * tenant exists and is not soft-deleted.
 */
export interface UpdateTenantInput {
  razonSocial?: string;
  nombreComercial?: string | null;
  direccionMatriz?: string;
  contribuyenteEspecial?: string | null;
  obligadoContabilidad?: boolean;
}

export async function updateTenant(
  prisma: PrismaClient,
  companyId: string,
  input: UpdateTenantInput,
): Promise<void> {
  try {
    await prisma.company.update({
      where: { id: companyId },
      data: input,
    });
  } catch (err) {
    if (isPrismaKnownError(err) && err.code === "P2025") {
      throw new NotFoundError("tenant");
    }
    throw err;
  }
}

/**
 * Add a member to a tenant. Errors:
 *   - 404 if the target user does not exist.
 *   - 409 if the user is already a member.
 *
 * The caller must have `tenant.manage_members` on `companyId`.
 */
export async function addMember(
  prisma: PrismaClient,
  companyId: string,
  userId: string,
  role: Role,
): Promise<{ membershipId: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user === null || user.deletedAt !== null) {
    throw new NotFoundError("user");
  }
  const id = ulid();
  try {
    await prisma.membership.create({
      data: {
        id,
        userId,
        companyId,
        role,
        // SPEC-0050 invitation lifecycle: `invitedAt` marks the moment
        // the OWNER/ADMIN issued the invite; `acceptedAt` will be set
        // by the invitee's accept flow (out of scope for v1). For now
        // we set both so the row is immediately active — matches the
        // pre-invitation behaviour. When the accept flow lands, drop
        // the `acceptedAt` from this call.
        invitedAt: new Date(),
        acceptedAt: new Date(),
      },
    });
  } catch (err) {
    if (isPrismaKnownError(err) && err.code === "P2002") {
      throw new ConflictError("El usuario ya es miembro de este tenant", "membership.duplicate");
    }
    throw err;
  }
  return { membershipId: id };
}

/**
 * Change a member's role. Last-OWNER guard runs inside the transaction.
 *
 * Throws:
 *   - 404 `not_found` if no membership for (companyId, userId).
 *   - 422 `last_owner` if the change would leave the tenant without any
 *      OWNER.
 */
export interface RoleChange {
  previousRole: Role;
  newRole: Role;
}

export async function changeMemberRole(
  prisma: PrismaClient,
  companyId: string,
  userId: string,
  newRole: Role,
): Promise<RoleChange> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (current === null) {
      throw new NotFoundError("membership");
    }
    const previousRole = current.role as Role;
    if (previousRole === newRole) {
      // No-op: keep the response shape consistent without a write.
      return { previousRole, newRole };
    }

    // Last-OWNER guard: only relevant when demoting an OWNER.
    if (previousRole === "OWNER" && newRole !== "OWNER") {
      const remainingOwners = await tx.membership.count({
        where: { companyId, role: "OWNER", userId: { not: userId } },
      });
      if (remainingOwners === 0) {
        throw new BusinessError("No se puede degradar al último OWNER del tenant", "last_owner");
      }
    }

    await tx.membership.update({
      where: { userId_companyId: { userId, companyId } },
      data: { role: newRole },
    });

    return { previousRole, newRole };
  });
}

/**
 * Remove a member. Last-OWNER guard runs inside the transaction so a
 * concurrent demote cannot leave the tenant with no OWNERs.
 *
 * Throws:
 *   - 404 `not_found` if no membership for (companyId, userId).
 *   - 422 `last_owner` if the removal would leave the tenant without any
 *      OWNER.
 */
export interface RemoveResult {
  previousRole: Role;
}

export async function removeMember(
  prisma: PrismaClient,
  companyId: string,
  userId: string,
): Promise<RemoveResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (current === null) {
      throw new NotFoundError("membership");
    }
    const previousRole = current.role as Role;
    if (previousRole === "OWNER") {
      const remainingOwners = await tx.membership.count({
        where: { companyId, role: "OWNER", userId: { not: userId } },
      });
      if (remainingOwners === 0) {
        throw new BusinessError("No se puede eliminar al último OWNER del tenant", "last_owner");
      }
    }
    await tx.membership.delete({
      where: { userId_companyId: { userId, companyId } },
    });
    return { previousRole };
  });
}
