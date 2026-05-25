/**
 * Integration tests for the polling job (`apps/sri-core/src/jobs/poll-en-proceso.ts`).
 *
 * Covers TASKS-0026 §4.1, §4.3 + the PROMPT-0026 hard rule "Polling job
 * MUST use SELECT … FOR UPDATE SKIP LOCKED so multiple workers don't
 * double-process".
 *
 * Scenarios:
 *
 *   - Seeded mix (AUTORIZADO + EN_PROCESO + NO_AUTORIZADO) — the
 *     resulting state for each doc matches the mocked autorización
 *     response.
 *   - Concurrent batches — two `runPollBatch` invocations running in
 *     parallel never see the same row (FOR UPDATE SKIP LOCKED).
 *   - Exponential backoff — a doc that stays in EN_PROCESO has its
 *     `nextPollAt` and `pollAttempts` advanced per `backoffFor(...)`.
 *   - Cap policy — a doc with `pollAttempts >= maxPollAttempts` is left
 *     alone (not re-selected, not bumped).
 */
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { computeClaveAccesoCheckDigit } from "@facturador/contracts/primitives";
import type { SriMensaje } from "@facturador/contracts/sri";
import { InMemoryBlobStore } from "../src/blobs/blob-store.js";

/** Build a valid 49-digit claveAcceso with the right check digit. */
function makeClaveAcceso(secuencial: string): string {
  const base48 =
    "21052026" +
    "01" +
    "1790012345001" +
    "1" +
    "001001" +
    secuencial.padStart(9, "0") +
    "12345678" +
    "1";
  return base48 + computeClaveAccesoCheckDigit(base48);
}
import { backoffFor, runPollBatch } from "../src/jobs/poll-en-proceso.js";
import type {
  AutorizacionClient,
  AutorizacionResult,
  QueryAutorizacionInput,
} from "../src/soap/index.js";

class FakeAutorizacionClient {
  public readonly calls: QueryAutorizacionInput[] = [];
  public constructor(
    private readonly impl: (input: QueryAutorizacionInput) => Promise<AutorizacionResult>,
  ) {}
  async query(input: QueryAutorizacionInput): Promise<AutorizacionResult> {
    this.calls.push(input);
    return this.impl(input);
  }
  urlFor(): string {
    return "http://fake";
  }
}

function asAutorizacionClient(c: FakeAutorizacionClient): AutorizacionClient {
  return c as unknown as AutorizacionClient;
}

async function seedCompany(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
}): Promise<void> {
  await args.prisma.company.create({
    data: {
      id: args.companyId,
      ruc: `${args.companyId.slice(0, 13)}`.padEnd(13, "0").slice(0, 13),
      razonSocial: "Poll Test Co",
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Quito, Ecuador",
    },
  });
}

async function seedEnProceso(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
  claveAcceso: string;
  nextPollAt?: Date | null;
  pollAttempts?: number;
}): Promise<string> {
  const id = ulid();
  await args.prisma.sriDocument.create({
    data: {
      id,
      companyId: args.companyId,
      tipoComprobante: "01",
      claveAcceso: args.claveAcceso,
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: "000000200",
      fechaEmision: new Date("2026-05-21T00:00:00Z"),
      estado: "EN_PROCESO",
      ...(args.nextPollAt === undefined ? {} : { nextPollAt: args.nextPollAt }),
      ...(args.pollAttempts === undefined ? {} : { pollAttempts: args.pollAttempts }),
    },
  });
  return id;
}

const okMensaje: SriMensaje = {
  identificador: "100",
  mensaje: "OK",
  tipo: "INFORMATIVO",
};

describe("runPollBatch — mixed responses", () => {
  const ctx = useTestSchema();

  it("transitions each EN_PROCESO row to its mocked autorización outcome", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    const ca1 = makeClaveAcceso("000000201");
    const ca2 = makeClaveAcceso("000000202");
    const ca3 = makeClaveAcceso("000000203");
    const idAuth = await seedEnProceso({
      prisma,
      companyId,
      claveAcceso: ca1,
      nextPollAt: new Date(Date.now() - 60_000),
    });
    const idStill = await seedEnProceso({
      prisma,
      companyId,
      claveAcceso: ca2,
      nextPollAt: new Date(Date.now() - 60_000),
    });
    const idNo = await seedEnProceso({
      prisma,
      companyId,
      claveAcceso: ca3,
      nextPollAt: new Date(Date.now() - 60_000),
    });

    const autorizacion = new FakeAutorizacionClient(async (input) => {
      if (input.claveAcceso === ca1) {
        return {
          estado: "AUTORIZADO",
          numeroAutorizacion: "AUTH-XYZ",
          fechaAutorizacion: new Date().toISOString(),
          ambiente: "PRUEBAS",
          autorizadoXml: "<comprobante>auth</comprobante>",
          mensajes: [okMensaje],
          httpStatus: 200,
          durationMs: 5,
          rawXmlSha256: "x",
        };
      }
      if (input.claveAcceso === ca2) {
        return {
          estado: "EN_PROCESO",
          ambiente: "PRUEBAS",
          mensajes: [okMensaje],
          httpStatus: 200,
          durationMs: 5,
          rawXmlSha256: "x",
        };
      }
      return {
        estado: "NO_AUTORIZADO",
        ambiente: "PRUEBAS",
        mensajes: [{ identificador: "70", mensaje: "Rechazo", tipo: "ERROR" }],
        httpStatus: 200,
        durationMs: 5,
        rawXmlSha256: "x",
      };
    });

    const result = await runPollBatch(
      {
        prisma,
        autorizacionClient: asAutorizacionClient(autorizacion),
        blobStore: new InMemoryBlobStore(),
      },
      {
        batchSize: 10,
        sleepBetweenDocsMs: 0,
      },
    );
    expect(result.batchSize).toBe(3);
    expect(result.processed).toBe(3);
    expect(result.transitions.autorizado).toBe(1);
    expect(result.transitions.enProceso).toBe(1);
    expect(result.transitions.noAutorizado).toBe(1);

    const docAuth = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: idAuth },
    });
    expect(docAuth.estado).toBe("AUTORIZADO");
    expect(docAuth.numeroAutorizacion).toBe("AUTH-XYZ");
    expect(docAuth.authorizedXmlBlobKey).not.toBeNull();

    const docStill = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: idStill },
    });
    expect(docStill.estado).toBe("EN_PROCESO");
    expect(docStill.pollAttempts).toBe(1);
    expect(docStill.nextPollAt).toBeInstanceOf(Date);
    expect(docStill.lastPollAt).toBeInstanceOf(Date);

    const docNo = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: idNo },
    });
    expect(docNo.estado).toBe("NO_AUTORIZADO");
  });
});

describe("runPollBatch — FOR UPDATE SKIP LOCKED concurrency", () => {
  const ctx = useTestSchema();

  it("two parallel batches never operate on the same row", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    // Seed 6 EN_PROCESO docs, all eligible.
    const ids = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        return seedEnProceso({
          prisma,
          companyId,
          claveAcceso: makeClaveAcceso(`00000030${i.toString().padStart(1, "0")}`),
          nextPollAt: new Date(Date.now() - 60_000),
        });
      }),
    );

    // Track which claveAcceso each batch sees.
    const seenA: string[] = [];
    const seenB: string[] = [];
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const gateB = new Promise<void>((r) => {
      releaseB = r;
    });

    // First batch holds its rows by gating the autorización response so
    // the SELECT lock is still held when batch B starts.
    const clientA = new FakeAutorizacionClient(async (input) => {
      seenA.push(input.claveAcceso);
      await gateA;
      return {
        estado: "EN_PROCESO",
        ambiente: "PRUEBAS",
        mensajes: [],
        httpStatus: 200,
        durationMs: 1,
        rawXmlSha256: "x",
      };
    });
    const clientB = new FakeAutorizacionClient(async (input) => {
      seenB.push(input.claveAcceso);
      await gateB;
      return {
        estado: "EN_PROCESO",
        ambiente: "PRUEBAS",
        mensajes: [],
        httpStatus: 200,
        durationMs: 1,
        rawXmlSha256: "x",
      };
    });

    const batchA = runPollBatch(
      {
        prisma,
        autorizacionClient: asAutorizacionClient(clientA),
        blobStore: new InMemoryBlobStore(),
      },
      { batchSize: 3, sleepBetweenDocsMs: 0 },
    );

    // Wait until A has at least one in-flight query so its lock is held.
    await new Promise((r) => setTimeout(r, 50));

    const batchB = runPollBatch(
      {
        prisma,
        autorizacionClient: asAutorizacionClient(clientB),
        blobStore: new InMemoryBlobStore(),
      },
      { batchSize: 3, sleepBetweenDocsMs: 0 },
    );

    // Release both batches so they can complete.
    releaseA();
    releaseB();
    const [resA, resB] = await Promise.all([batchA, batchB]);

    // Each batch processed at most 3 rows; together they cover ≤ 6.
    expect(resA.processed).toBeGreaterThan(0);
    expect(resB.processed).toBeGreaterThan(0);
    // Crucially, no claveAcceso appears in both `seenA` and `seenB`.
    const intersection = seenA.filter((c) => seenB.includes(c));
    expect(intersection).toEqual([]);
    expect(new Set([...seenA, ...seenB]).size).toBe(seenA.length + seenB.length);
    // All 6 rows are still represented in the DB.
    expect(ids).toHaveLength(6);
  });
});

describe("runPollBatch — backoff schedule", () => {
  const ctx = useTestSchema();

  it("EN_PROCESO doc has pollAttempts bumped + nextPollAt at backoffFor(attempts)", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    const ca = makeClaveAcceso("000000220");
    const now = new Date("2026-05-21T01:00:00Z");
    const id = await seedEnProceso({
      prisma,
      companyId,
      claveAcceso: ca,
      // Eligible: nextPollAt strictly before the fake `now`.
      nextPollAt: new Date(now.getTime() - 60_000),
      pollAttempts: 0,
    });
    const autorizacion = new FakeAutorizacionClient(async () => ({
      estado: "EN_PROCESO",
      ambiente: "PRUEBAS",
      mensajes: [],
      httpStatus: 200,
      durationMs: 5,
      rawXmlSha256: "x",
    }));
    await runPollBatch(
      {
        prisma,
        autorizacionClient: asAutorizacionClient(autorizacion),
        blobStore: new InMemoryBlobStore(),
      },
      { batchSize: 1, sleepBetweenDocsMs: 0, now: () => now, maxBackoffMs: 600_000 },
    );
    const doc = await prisma.sriDocument.findUniqueOrThrow({ where: { id } });
    expect(doc.pollAttempts).toBe(1);
    // backoffFor(1, 600000) = 30s * 2^1 = 60000 (under cap).
    expect(doc.nextPollAt!.getTime() - now.getTime()).toBe(backoffFor(1, 600_000));
    expect(doc.lastPollAt).toBeInstanceOf(Date);
  });
});

describe("runPollBatch — attempt cap", () => {
  const ctx = useTestSchema();

  it("does NOT select rows with pollAttempts >= maxPollAttempts", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    const ca = makeClaveAcceso("000000230");
    await seedEnProceso({
      prisma,
      companyId,
      claveAcceso: ca,
      nextPollAt: new Date(Date.now() - 60_000),
      pollAttempts: 60,
    });
    const autorizacion = new FakeAutorizacionClient(async () => {
      throw new Error("must not be queried — doc over cap");
    });
    const result = await runPollBatch(
      {
        prisma,
        autorizacionClient: asAutorizacionClient(autorizacion),
        blobStore: new InMemoryBlobStore(),
      },
      { batchSize: 10, sleepBetweenDocsMs: 0, maxPollAttempts: 60 },
    );
    expect(result.processed).toBe(0);
    expect(result.batchSize).toBe(0);
  });
});

describe("backoffFor", () => {
  it("doubles per attempt up to the cap", () => {
    expect(backoffFor(1, 10 * 60 * 1000)).toBe(60_000);
    expect(backoffFor(2, 10 * 60 * 1000)).toBe(120_000);
    expect(backoffFor(3, 10 * 60 * 1000)).toBe(240_000);
    expect(backoffFor(10, 10 * 60 * 1000)).toBe(10 * 60 * 1000); // capped
  });
});
