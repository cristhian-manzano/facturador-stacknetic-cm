/**
 * `auditLogFactory` — synthetic AuditLog fixture (TASKS-0007 §5.2).
 *
 * Mirrors the `AuditLog` Prisma model.  `payloadJson` is intentionally
 * unconstrained at the type level (Json), but the fixture's default
 * payload uses only synthetic identifiers — no real PII (TASKS-0007 §5).
 */
import { newId } from "./_ids.js";

export interface AuditLogFixture {
  id: string;
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  payloadJson: Record<string, unknown> | null;
}

export interface AuditLogFactoryInput {
  action?: string;
  entity?: string;
  entityId?: string;
  companyId?: string | null;
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  payloadJson?: Record<string, unknown> | null;
}

export function auditLogFactory(input: AuditLogFactoryInput = {}): AuditLogFixture {
  return {
    id: newId(),
    companyId: input.companyId ?? null,
    actorUserId: input.actorUserId ?? null,
    action: input.action ?? "auth.login.success",
    entity: input.entity ?? "Session",
    entityId: input.entityId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? "Vitest/2 (FixtureClient)",
    payloadJson: input.payloadJson ?? { source: "fixture" },
  };
}
