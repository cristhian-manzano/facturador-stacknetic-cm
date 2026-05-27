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

import { computeAuditPayloadHash } from "./payload-hash.js";
import { redactPayload } from "./redact.js";

/**
 * Minimal Prisma surface area the helper requires. We type only the slice
 * we use so the test suite can pass a stub without pulling the full
 * `PrismaClient` generic.
 *
 * `subjectHash` (sha256 hex of the canonicalised "subject" of the event —
 * for `auth.login.failure` rows the subject is the lowercased email)
 * and `payloadHash` (sha256(prev.payloadHash || canonical(payloadJson)))
 * are nullable strings carried alongside the existing row shape. Both
 * columns exist on the `audit_log` Postgres table per the production-
 * readiness migration. We type them as `string | null` so a stub Prisma
 * client without the columns set can still match this surface (TS won't
 * error if the caller's `data` carries extra keys, but a strict caller
 * would).
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
        subjectHash?: string | null;
        payloadJson: unknown;
        payloadHash?: string | null;
      };
    }): Promise<unknown>;
    /**
     * Optional: callers that wire the hash chain must expose `findFirst`
     * (or a compatible accessor) so the helper can pull the predecessor
     * row's `payloadHash`. Stubs that don't expose it skip the chain
     * (genesis row).
     */
    findFirst?(args: {
      where: { companyId: string | null };
      orderBy: { createdAt: "desc" };
      select: { payloadHash: true };
    }): Promise<{ payloadHash: string | null } | null>;
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
  /**
   * Optional sha256 hex of the canonicalised event "subject". For
   * `auth.login.failure` rows the subject is the lowercased email; for
   * other action types this is typically `undefined`. The helper passes
   * it through unchanged — callers MUST pre-hash (we never want raw PII
   * to reach this signature, even momentarily).
   */
  readonly subjectHash?: string | null;
  /** Free-form metadata; redacted at write time. */
  readonly payloadJson?: Record<string, unknown> | null;
}

export interface AuditDependencies {
  /** Prisma client (or compatible stub for tests). */
  readonly prisma: AuditPrismaClient;
  /**
   * Logger used to emit a single error/debug line if the write fails.
   *
   * The helper writes at `error` for genuine failures (DB unreachable,
   * unique-constraint violation, etc.) and at `debug` for FK violations
   * (Prisma code `P2003`) so test runs against schemas without seeded
   * `Company`/`User` rows don't drown the output. The audit punchlist
   * Item 14 (REVIEW-0026 §8) drove this distinction.
   *
   * `debug` is feature-sniffed at call time so test stubs that only
   * expose `error` + `info` keep working; the FK branch then falls
   * back to `info`.
   */
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

  // ----- Hash-chain (REVIEW-0006 §10 #6) --------------------------------
  //
  // payloadHash = SHA-256(prev.payloadHash || canonicalJson(payload)).
  // We pull the predecessor row's hash with a single point query scoped
  // to the same `(companyId)` partition. Any failure on the lookup is
  // swallowed: the chain breaks but the audit row still lands (correctness
  // > tamper detection on the write path).
  let prevPayloadHash: string | null = null;
  if (typeof deps.prisma.auditLog.findFirst === "function") {
    try {
      const prev = await deps.prisma.auditLog.findFirst({
        where: { companyId: input.companyId ?? null },
        orderBy: { createdAt: "desc" },
        select: { payloadHash: true },
      });
      prevPayloadHash = prev?.payloadHash ?? null;
    } catch {
      // Don't let a lookup failure block the audit write — emit a debug
      // line (best-effort) and fall through with no predecessor (the
      // chain "restarts" for this row; ops can re-link offline).
      const debug = (deps.logger as { debug?: Logger["info"] }).debug;
      const sink = debug ?? deps.logger.info;
      sink({ event: "audit.chain_lookup_failed" }, "audit_chain_lookup_failed");
    }
  }
  const payloadForHash = safePayload ?? {};
  const payloadHash = computeAuditPayloadHash(prevPayloadHash, payloadForHash);

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
        subjectHash: input.subjectHash ?? null,
        payloadJson: safePayload,
        payloadHash,
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
    //
    // Audit punchlist Item 14 (REVIEW-0026 §8): Prisma error code
    // `P2003` is a FK violation — common in tests where the
    // `companyId` references a Company row that the test never
    // seeded. Demote those to `debug` so test output stays clean
    // while still surfacing them for the operator who turns up
    // verbose logging. Genuine failures (P1001 DB unreachable,
    // P2002 unique-violation, etc.) keep their `error` level.
    if (isPrismaFkViolation(err)) {
      // Use `debug` when the caller's logger exposes it (Pino does);
      // fall back to `info` for the in-memory test stubs that don't.
      const debug = (deps.logger as { debug?: Logger["info"] }).debug;
      const sink = debug ?? deps.logger.info;
      sink(
        {
          err,
          event: "audit.write_skipped_fk",
          action: input.action,
          entity: input.entity,
          companyId: input.companyId ?? null,
        },
        "audit_write_skipped_fk",
      );
      return;
    }
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

/**
 * Detect Prisma's `P2003` foreign-key violation.
 *
 * We feature-sniff on the `code` field rather than `instanceof` so the
 * helper stays decoupled from the `@prisma/client` runtime — this
 * package is consumed by tests with stub Prisma clients that don't
 * import the runtime error classes.
 */
function isPrismaFkViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2003";
}
