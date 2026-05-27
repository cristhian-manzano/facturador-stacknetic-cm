/**
 * Unit tests for `audit()` against an in-memory stub.
 *
 * The integration test against a real Postgres lives in
 * `apps/api/src/audit.integration.test.ts`; this file covers the
 * behavioural contract:
 *   - Writes a row with redacted payload.
 *   - NEVER throws on Prisma failure.
 *   - Emits exactly one error log line on failure.
 */
import { describe, expect, it, vi } from "vitest";

import { audit, type AuditPrismaClient } from "./audit.js";

function makeStubPrisma() {
  const create = vi.fn();
  const prisma: AuditPrismaClient = {
    auditLog: {
      create: create as unknown as AuditPrismaClient["auditLog"]["create"],
    },
  };
  return { prisma, create };
}

function makeStubLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("audit()", () => {
  it("writes a row with deterministic id when newId is injected", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    create.mockResolvedValueOnce({});

    await audit(
      { prisma, logger, newId: () => "01HX8K0PYFA9B7Y1M2N3P4Q5R6" },
      {
        action: "auth.login.success",
        entity: "Session",
        actorUserId: "01HUSER0",
        companyId: "01HCO0",
      },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      id: "01HX8K0PYFA9B7Y1M2N3P4Q5R6",
      action: "auth.login.success",
      entity: "Session",
      actorUserId: "01HUSER0",
      companyId: "01HCO0",
      entityId: null,
      ip: null,
      userAgent: null,
      payloadJson: null,
    });
    // payloadHash chain is computed by default — empty stub means
    // the helper hashes "" || canonicalJson({}) = sha256("|{}").
    expect(typeof args.data.payloadHash).toBe("string");
    expect(args.data.payloadHash as string).toHaveLength(64);
  });

  it("redacts payloadJson before insert", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    create.mockResolvedValueOnce({});

    await audit(
      { prisma, logger },
      {
        action: "certificate.uploaded",
        entity: "Certificate",
        payloadJson: {
          p12: "<binary>",
          privateKey: "PEM",
          fileName: "cert.p12",
          nested: { passphrase: "secret", ok: 1 },
        },
      },
    );

    const args = create.mock.calls[0]?.[0] as { data: { payloadJson: Record<string, unknown> } };
    const payload = args.data.payloadJson;
    expect(payload.p12).toBe("[REDACTED]");
    expect(payload.privateKey).toBe("[REDACTED]");
    expect(payload.fileName).toBe("cert.p12");
    const nested = payload.nested as Record<string, unknown>;
    expect(nested.passphrase).toBe("[REDACTED]");
    expect(nested.ok).toBe(1);
  });

  it("emits an info log on success", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    create.mockResolvedValueOnce({});

    await audit(
      { prisma, logger },
      { action: "tenant.switched", entity: "Session", actorUserId: "u" },
    );

    expect(logger.info).toHaveBeenCalledTimes(1);
    const call = logger.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.event).toBe("audit");
    expect(call.action).toBe("tenant.switched");
  });

  it("swallows Prisma errors and emits a single error log line", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    create.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      audit({ prisma, logger }, { action: "auth.login.failure", entity: "Session" }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const call = logger.error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.event).toBe("audit.write_failed");
    expect(call.action).toBe("auth.login.failure");
  });

  it("passes through subjectHash when supplied (auth.login.failure path)", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    create.mockResolvedValueOnce({});

    await audit(
      { prisma, logger },
      {
        action: "auth.login.failure",
        entity: "Session",
        subjectHash: "a".repeat(64),
        payloadJson: { reason: "bad_credentials" },
      },
    );

    const args = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data.subjectHash).toBe("a".repeat(64));
  });

  it("chains payloadHash using the previous row's hash for the same companyId", async () => {
    // Build a stub prisma whose findFirst returns the predecessor's hash.
    const create = vi.fn();
    const findFirst = vi.fn();
    const prisma: AuditPrismaClient = {
      auditLog: {
        create: create as unknown as AuditPrismaClient["auditLog"]["create"],
        findFirst: findFirst as unknown as NonNullable<AuditPrismaClient["auditLog"]["findFirst"]>,
      },
    };
    const logger = makeStubLogger();
    // Row 1: no predecessor (genesis).
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({});
    await audit(
      { prisma, logger },
      {
        action: "tenant.member_added",
        entity: "Membership",
        companyId: "01HCO0",
        payloadJson: { role: "VIEWER" },
      },
    );
    const row1 = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    const hash1 = row1.data.payloadHash as string;
    expect(hash1).toHaveLength(64);

    // Row 2: predecessor returns row 1's hash.
    findFirst.mockResolvedValueOnce({ payloadHash: hash1 });
    create.mockResolvedValueOnce({});
    await audit(
      { prisma, logger },
      {
        action: "tenant.member_added",
        entity: "Membership",
        companyId: "01HCO0",
        payloadJson: { role: "OPERATOR" },
      },
    );
    const row2 = create.mock.calls[1]?.[0] as { data: Record<string, unknown> };
    const hash2 = row2.data.payloadHash as string;
    expect(hash2).toHaveLength(64);
    expect(hash2).not.toBe(hash1);

    // Row 3: predecessor returns row 2's hash.
    findFirst.mockResolvedValueOnce({ payloadHash: hash2 });
    create.mockResolvedValueOnce({});
    await audit(
      { prisma, logger },
      {
        action: "tenant.member_added",
        entity: "Membership",
        companyId: "01HCO0",
        payloadJson: { role: "OWNER" },
      },
    );
    const row3 = create.mock.calls[2]?.[0] as { data: Record<string, unknown> };
    const hash3 = row3.data.payloadHash as string;
    expect(hash3).toHaveLength(64);
    expect(hash3).not.toBe(hash2);
    expect(hash3).not.toBe(hash1);
  });

  it("demotes Prisma P2003 FK violations to debug (audit punchlist Item 14)", async () => {
    const { prisma, create } = makeStubPrisma();
    const logger = makeStubLogger();
    const fkError = Object.assign(new Error("foreign key constraint failed"), {
      code: "P2003",
    });
    create.mockRejectedValueOnce(fkError);

    await expect(
      audit(
        { prisma, logger },
        { action: "sri.event", entity: "SriDocument", companyId: "orphan-id" },
      ),
    ).resolves.toBeUndefined();

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    const call = logger.debug.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.event).toBe("audit.write_skipped_fk");
    expect(call.companyId).toBe("orphan-id");
  });
});
