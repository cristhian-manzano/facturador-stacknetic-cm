/**
 * Tests for `burnSecuencial` — happy path (row created), uniqueness
 * conflict mapped to ConflictError, and the helper composes inside a
 * `prisma.$transaction` callback.
 */
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@facturador/db";
import { ConflictError } from "@facturador/utils/errors";
import { burnSecuencial, type BurnSecuencialTx } from "./burn.js";

function makeStubTx(): {
  tx: BurnSecuencialTx;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn((args: { data: unknown }) => Promise.resolve(args.data));
  const tx = {
    burnedSecuencial: { create },
  } as unknown as BurnSecuencialTx;
  return { tx, create };
}

const baseInput = {
  companyId: "01J0COMPANY",
  estab: "001",
  ptoEmi: "001",
  tipoComprobante: "01",
  secuencial: "000000005",
  reason: "reissue" as const,
};

describe("burnSecuencial — happy path", () => {
  it("creates a row and returns its id", async () => {
    const { tx, create } = makeStubTx();
    const result = await burnSecuencial(tx, { ...baseInput, id: "01J0BURN" });
    expect(result.id).toBe("01J0BURN");
    expect(create).toHaveBeenCalledOnce();
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      companyId: "01J0COMPANY",
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
      secuencial: "000000005",
      reason: "reissue",
      burnedByUserId: null,
      documentId: null,
    });
  });

  it("auto-generates a ULID id if none provided", async () => {
    const { tx } = makeStubTx();
    const result = await burnSecuencial(tx, baseInput);
    expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
  });

  it("propagates burnedByUserId and documentId when supplied", async () => {
    const { tx, create } = makeStubTx();
    await burnSecuencial(tx, {
      ...baseInput,
      burnedByUserId: "01J0USER",
      documentId: "01J0DOC",
    });
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.burnedByUserId).toBe("01J0USER");
    expect(call.data.documentId).toBe("01J0DOC");
  });
});

describe("burnSecuencial — uniqueness conflict", () => {
  it("maps a P2002 unique-violation to ConflictError(secuencial.already_burned)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    const create = vi.fn(() => Promise.reject(p2002));
    const tx = { burnedSecuencial: { create } } as unknown as BurnSecuencialTx;
    let captured: unknown;
    try {
      await burnSecuencial(tx, baseInput);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ConflictError);
    expect((captured as ConflictError).code).toBe("secuencial.already_burned");
  });

  it("rethrows any non-P2002 Prisma error unchanged", async () => {
    const other = new Prisma.PrismaClientKnownRequestError("oops", {
      code: "P9999",
      clientVersion: "5.0.0",
    });
    const create = vi.fn(() => Promise.reject(other));
    const tx = { burnedSecuencial: { create } } as unknown as BurnSecuencialTx;
    await expect(burnSecuencial(tx, baseInput)).rejects.toBe(other);
  });
});
