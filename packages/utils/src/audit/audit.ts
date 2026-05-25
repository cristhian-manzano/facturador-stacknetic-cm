/**
 * `audit()` — durable append-only event log for security-sensitive actions.
 *
 * Per SPEC-0006 §6.8 + TASKS-0006 §4.1 + PROMPT-0006 hard constraints:
 *
 *   - Writes a row to `AuditLog` via the injected Prisma client.
 *   - NEVER throws. Failures are swallowed and emitted as a single `error`
 *     log line so the surrounding business flow continues.
 *   - Redacts `payloadJson` through the project-wide sensitive-key walker
 *     before insert. The redactor reuses `REDACT_PATHS` from `@facturador/logger`
 *     so the two surfaces stay in lockstep.
 *
 * Dependency injection avoids a circular dep between `@facturador/utils` and
 * `@facturador/db`: callers (apps/api, apps/sri-core) construct the Prisma
 * client and pass it in.
 */
import { ulid } from "ulid";
import type { Logger } from "@facturador/logger";
import { redactPayload } from "./redact.js";

/**
 * Minimal Prisma surface area the helper requires. We type only the slice
 * we use so the test suite can pass a stub without pulling the full
 * `PrismaClient` generic.
 */
export interface AuditPrismaClient {
  auditLog: {
    create(args: {
      data: {
        id: string;
        companyId: string | null;
        actorUserId: string | null;
        action: string;
        entity: string;
        entityId: string | null;
        ip: string | null;
        userAgent: string | null;
        payloadJson: unknown;
      };
    }): Promise<unknown>;
  };
}

export interface AuditInput {
  /** Canonical action name; SPEC-0006 §6.8 lists allowed prefixes. */
  readonly action: string;
  /** Entity touched, e.g. "Session", "Certificate", "Invoice". */
  readonly entity: string;
  /** Optional entity ULID. */
  readonly entityId?: string;
  /** Tenant scope; null for system-level events (login attempts). */
  readonly companyId?: string | null;
  /** Acting user; null for unauthenticated actions. */
  readonly actorUserId?: string | null;
  /** Optional caller IP (already hashed/truncated by caller). */
  readonly ip?: string | null;
  /** Optional User-Agent string. */
  readonly userAgent?: string | null;
  /** Free-form metadata; redacted at write time. */
  readonly payloadJson?: Record<string, unknown> | null;
}

export interface AuditDependencies {
  /** Prisma client (or compatible stub for tests). */
  readonly prisma: AuditPrismaClient;
  /** Logger used to emit a single error line if the write fails. */
  readonly logger: Pick<Logger, "error" | "info">;
  /**
   * Override the id generator. Tests may inject deterministic IDs. Defaults
   * to `ulid()`.
   */
  readonly newId?: () => string;
}

/**
 * Persist an audit entry. Returns `void` regardless of success/failure;
 * the caller MUST be able to ignore the outcome (best-effort semantics).
 */
export async function audit(deps: AuditDependencies, input: AuditInput): Promise<void> {
  const id = (deps.newId ?? ulid)();
  const safePayload =
    input.payloadJson === undefined || input.payloadJson === null
      ? null
      : (redactPayload(input.payloadJson) as Record<string, unknown>);

  try {
    await deps.prisma.auditLog.create({
      data: {
        id,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        companyId: input.companyId ?? null,
        actorUserId: input.actorUserId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        payloadJson: safePayload,
      },
    });

    // Mirror as an `info` log so observability tooling picks it up too.
    deps.logger.info(
      {
        event: "audit",
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        companyId: input.companyId ?? null,
        actorUserId: input.actorUserId ?? null,
      },
      "audit",
    );
  } catch (err) {
    // SPEC-0006 NFR + TASKS-0006 §4.1: swallow + log. The error is logged
    // through the same redaction-enabled logger.
    deps.logger.error(
      {
        err,
        event: "audit.write_failed",
        action: input.action,
        entity: input.entity,
      },
      "audit_write_failed",
    );
  }
}
