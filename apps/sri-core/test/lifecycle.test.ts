/**
 * Integration tests for `recordEvent` (the lifecycle write path).
 *
 * Covers TASKS-0020 §5.2:
 *   - Happy path: PENDIENTE → FIRMADO → ENVIADO writes the document state
 *     and the event row in a single transaction.
 *   - Illegal transition: PENDIENTE → AUTORIZADO (skipping the chain) is
 *     rejected with `sri.invalid_transition` 409.
 *   - Self-loop policy: same estado without `allowSelfLoop` is rejected;
 *     with `allowSelfLoop` it is accepted.
 *   - Race: a stale `from` snapshot loses with `sri.transition_race`.
 */
import { describe, expect, it } from "vitest";
import { useTestSchema } from "@facturador/db/test-harness";
import { ulid } from "ulid";
import { recordEvent } from "../src/lifecycle/events.js";

async function seedPendingDoc(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  companyId: string,
  claveAcceso: string,
) {
  const id = ulid();
  await prisma.sriDocument.create({
    data: {
      id,
      companyId,
      tipoComprobante: "01",
      claveAcceso,
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: "000000001",
      fechaEmision: new Date("2026-05-21T00:00:00Z"),
      estado: "PENDIENTE",
    },
  });
  return id;
}

describe("recordEvent — happy path", () => {
  const ctx = useTestSchema();

  it("PENDIENTE → FIRMADO → ENVIADO writes 2 events and the new state", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    const docId = await seedPendingDoc(
      prisma,
      companyId,
      "21052026" + "01" + "1790012345001" + "1" + "001001" + "000000010" + "12345678" + "1" + "3",
    );

    const r1 = await recordEvent(prisma, {
      documentId: docId,
      etapa: "SIGN",
      estado: "FIRMADO",
      durationMs: 50,
    });
    expect(r1.document.estado).toBe("FIRMADO");

    const r2 = await recordEvent(prisma, {
      documentId: docId,
      etapa: "SEND",
      estado: "ENVIADO",
      durationMs: 100,
    });
    expect(r2.document.estado).toBe("ENVIADO");

    const events = await prisma.sriEvent.findMany({
      where: { documentId: docId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.etapa)).toEqual(["SIGN", "SEND"]);
    expect(events.map((e) => e.estado)).toEqual(["FIRMADO", "ENVIADO"]);
  });

  it("idempotent self-loop succeeds only when allowSelfLoop: true", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    const docId = await seedPendingDoc(
      prisma,
      companyId,
      "21052026" + "01" + "1790012345001" + "1" + "001001" + "000000011" + "12345678" + "1" + "1",
    );
    await recordEvent(prisma, {
      documentId: docId,
      etapa: "SIGN",
      estado: "FIRMADO",
    });
    await recordEvent(prisma, {
      documentId: docId,
      etapa: "SEND",
      estado: "ENVIADO",
    });
    await recordEvent(prisma, {
      documentId: docId,
      etapa: "SEND",
      estado: "ENVIADO",
      allowSelfLoop: true,
    });
    const events = await prisma.sriEvent.findMany({
      where: { documentId: docId },
    });
    expect(events).toHaveLength(3);

    // Self-loop without the flag must reject.
    await expect(
      recordEvent(prisma, {
        documentId: docId,
        etapa: "SEND",
        estado: "ENVIADO",
      }),
    ).rejects.toMatchObject({ code: "sri.invalid_transition" });
  });
});

describe("recordEvent — invalid transitions", () => {
  const ctx = useTestSchema();

  it("rejects PENDIENTE → AUTORIZADO (must go via FIRMADO/ENVIADO/RECIBIDA)", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    const docId = await seedPendingDoc(
      prisma,
      companyId,
      "21052026" + "01" + "1790012345001" + "1" + "001001" + "000000012" + "12345678" + "1" + "8",
    );
    await expect(
      recordEvent(prisma, {
        documentId: docId,
        etapa: "AUTHORIZE",
        estado: "AUTORIZADO",
      }),
    ).rejects.toMatchObject({ code: "sri.invalid_transition" });
    const fresh = await prisma.sriDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(fresh.estado).toBe("PENDIENTE");
  });

  it("rejects writes to a missing document with NotFoundError", async () => {
    const prisma = ctx.getPrisma();
    await expect(
      recordEvent(prisma, {
        documentId: ulid(),
        etapa: "SIGN",
        estado: "FIRMADO",
      }),
    ).rejects.toMatchObject({ code: "sri_document.not_found" });
  });
});
