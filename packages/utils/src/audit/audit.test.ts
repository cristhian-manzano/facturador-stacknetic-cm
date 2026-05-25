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
});
