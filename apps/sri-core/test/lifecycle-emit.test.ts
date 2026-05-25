/**
 * Integration tests for the `emitFactura` orchestrator
 * (`apps/sri-core/src/lifecycle/emit-factura.ts`).
 *
 * Covers TASKS-0026 §5.1 – §5.7:
 *
 *   - Happy path: PENDIENTE → FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO.
 *   - DEVUELTA path (mensajes preserved, no retry).
 *   - EN_PROCESO path (sets nextPollAt; doesn't transition further).
 *   - ERROR_RED path (transient send failure; idempotent resume).
 *   - ERROR_BUILD path (invalid factura input).
 *   - Idempotency on AUTORIZADO (no new event row, no extra SOAP call).
 *   - Reissue refusal — exercised at the route level in
 *     `documents-resend.test.ts`.
 *
 * Strategy:
 *   - `useTestSchema` provides a fresh Postgres schema per test file.
 *   - The active certificate is seeded directly via Prisma — the
 *     cert-upload route is exercised elsewhere.
 *   - SOAP clients are programmable test doubles (no `vi.mock` global
 *     state); each test wires up a fresh pair so behaviour is local.
 *   - The XML body uses a fixture that satisfies `buildFacturaXml` so
 *     the orchestrator's BUILD step doesn't reject it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { computeClaveAccesoCheckDigit } from "@facturador/contracts/primitives";
import type { SriMensaje } from "@facturador/contracts/sri";
import { encryptP12 } from "../src/crypto/envelope.js";
import { __resetActiveCertificateCache } from "../src/certificates/active.js";
import { InMemoryBlobStore } from "../src/blobs/blob-store.js";
import { emitFactura } from "../src/lifecycle/emit-factura.js";
import {
  AutorizacionClient,
  RecepcionClient,
  SriClientError,
  type RecepcionResult,
  type AutorizacionResult,
  type SendRecepcionInput,
  type QueryAutorizacionInput,
} from "../src/soap/index.js";
import { generateSyntheticP12 } from "./fixtures/synthetic-cert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const day = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function loadGoldenFacturaInput(): unknown {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "fixtures", "factura", "golden-01.input.json"), "utf8"),
  ) as unknown;
}

async function seedCompany(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
}): Promise<void> {
  // Seed a minimal Company row so the audit() FK against `companyId` is
  // satisfied. The audit helper swallows errors so the tests would pass
  // either way; the seed just keeps the test output free of FK warnings.
  await args.prisma.company.create({
    data: {
      id: args.companyId,
      ruc: "1790012345001",
      razonSocial: "Synthetic Co",
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Quito, Ecuador",
    },
  });
}

async function seedActiveCert(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
}): Promise<void> {
  const subjectCN = "Emit-Factura Subject";
  const validTo = new Date(Date.now() + 365 * day);
  const passphrase = "test-pass";
  const { p12 } = generateSyntheticP12({
    subjectCN,
    validFrom: new Date(Date.now() - day),
    validTo,
    passphrase,
  });
  const envelope = encryptP12(p12);
  const passEnv = encryptP12(Buffer.from(passphrase, "utf8"));
  const fp = Buffer.from(`${args.companyId}|${subjectCN}|${validTo.toISOString()}`)
    .toString("hex")
    .padEnd(64, "f")
    .slice(0, 64);
  await args.prisma.certificate.create({
    data: {
      id: ulid(),
      companyId: args.companyId,
      subjectCN,
      issuerCN: subjectCN,
      serialNumber: Buffer.from(`${args.companyId}-${subjectCN}`).toString("hex").slice(0, 24),
      validFrom: new Date(Date.now() - day),
      validTo,
      fingerprintSha256: fp,
      alias: "primary",
      status: "ACTIVE",
      p12CiphertextB64: envelope.ciphertext.toString("base64"),
      p12NonceB64: envelope.nonce.toString("base64"),
      p12TagB64: envelope.tag.toString("base64"),
      passphraseCiphertextB64: passEnv.ciphertext.toString("base64"),
      passphraseNonceB64: passEnv.nonce.toString("base64"),
      passphraseTagB64: passEnv.tag.toString("base64"),
    },
  });
}

async function seedPending(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
  secuencial: string;
}): Promise<{ documentId: string; claveAcceso: string }> {
  const base48 =
    "21052026" +
    "01" +
    "1790012345001" +
    "1" +
    "001001" +
    args.secuencial.padStart(9, "0") +
    "12345678" +
    "1";
  const claveAcceso = base48 + computeClaveAccesoCheckDigit(base48);
  const id = ulid();
  await args.prisma.sriDocument.create({
    data: {
      id,
      companyId: args.companyId,
      tipoComprobante: "01",
      claveAcceso,
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: args.secuencial.padStart(9, "0"),
      fechaEmision: new Date("2026-05-21T00:00:00Z"),
      estado: "PENDIENTE",
    },
  });
  return { documentId: id, claveAcceso };
}

/* -------------------------------------------------------------------------- */
/* Programmable SOAP doubles                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A tiny test double that satisfies `RecepcionClient`'s public surface
 * (`send`). We don't subclass — the orchestrator only types it as
 * `RecepcionClient`, so a structural impl is enough.
 */
class FakeRecepcionClient {
  public calls = 0;
  public lastInput?: SendRecepcionInput;
  public constructor(
    private readonly impl: (
      input: SendRecepcionInput,
      callCount: number,
    ) => Promise<RecepcionResult>,
  ) {}
  async send(input: SendRecepcionInput): Promise<RecepcionResult> {
    this.calls += 1;
    this.lastInput = input;
    return this.impl(input, this.calls);
  }
  urlFor(): string {
    return "http://fake";
  }
}

class FakeAutorizacionClient {
  public calls = 0;
  public lastInput?: QueryAutorizacionInput;
  public constructor(
    private readonly impl: (
      input: QueryAutorizacionInput,
      callCount: number,
    ) => Promise<AutorizacionResult>,
  ) {}
  async query(input: QueryAutorizacionInput): Promise<AutorizacionResult> {
    this.calls += 1;
    this.lastInput = input;
    return this.impl(input, this.calls);
  }
  urlFor(): string {
    return "http://fake";
  }
}

function asRecepcionClient(c: FakeRecepcionClient): RecepcionClient {
  return c as unknown as RecepcionClient;
}
function asAutorizacionClient(c: FakeAutorizacionClient): AutorizacionClient {
  return c as unknown as AutorizacionClient;
}

const okMensaje: SriMensaje = {
  identificador: "100",
  mensaje: "OK",
  tipo: "INFORMATIVO",
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("emitFactura — happy path", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("walks PENDIENTE → FIRMADO → ENVIADO → RECIBIDA → AUTORIZADO with 4 events", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000100",
    });

    const recepcion = new FakeRecepcionClient(async () => ({
      estado: "RECIBIDA",
      mensajes: [okMensaje],
      httpStatus: 200,
      durationMs: 12,
      rawXmlSha256: "deadbeef",
      reclassifiedFromDevuelta: false,
    }));
    const autorizacion = new FakeAutorizacionClient(async () => ({
      estado: "AUTORIZADO",
      numeroAutorizacion: "AUTH-123",
      fechaAutorizacion: new Date("2026-05-21T01:02:03Z").toISOString(),
      ambiente: "PRUEBAS",
      autorizadoXml: "<comprobante>signed-with-receipt</comprobante>",
      mensajes: [okMensaje],
      httpStatus: 200,
      durationMs: 24,
      rawXmlSha256: "cafebabe",
    }));

    const blobStore = new InMemoryBlobStore();
    const result = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );

    expect(result.document.estado).toBe("AUTORIZADO");
    expect(result.document.numeroAutorizacion).toBe("AUTH-123");
    expect(result.document.authorizedXmlBlobKey).not.toBeNull();
    expect(result.didWork).toBe(true);
    expect(recepcion.calls).toBe(1);
    expect(autorizacion.calls).toBe(1);

    // Events: SIGN/FIRMADO, SEND/ENVIADO, RECEIVE/RECIBIDA, AUTHORIZE/AUTORIZADO.
    const events = await prisma.sriEvent.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" },
    });
    const etapas = events.map((e) => e.etapa);
    expect(etapas).toEqual(["SIGN", "SEND", "RECEIVE", "AUTHORIZE"]);
    const estados = events.map((e) => e.estado);
    expect(estados).toEqual(["FIRMADO", "ENVIADO", "RECIBIDA", "AUTORIZADO"]);
    // Every event row has a non-negative durationMs.
    for (const ev of events) {
      expect(ev.durationMs).toBeGreaterThanOrEqual(0);
    }

    // Blobs: signed.xml + authorized.xml present.
    const refreshed = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(refreshed.signedXmlBlobKey).not.toBeNull();
    expect(refreshed.authorizedXmlBlobKey).not.toBeNull();
    const signed = await blobStore.get(refreshed.signedXmlBlobKey ?? "");
    expect(signed).toContain("<ds:Signature");
    const authorized = await blobStore.get(refreshed.authorizedXmlBlobKey ?? "");
    expect(authorized).toBe("<comprobante>signed-with-receipt</comprobante>");
  });
});

describe("emitFactura — DEVUELTA path", () => {
  const ctx = useTestSchema();

  it("records DEVUELTA + mensajes and does not call autorización", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000110",
    });

    const mensajes: SriMensaje[] = [
      { identificador: "35", mensaje: "Firma inválida", tipo: "ERROR" },
      { identificador: "39", mensaje: "Firma caducada", tipo: "ERROR" },
    ];
    const recepcion = new FakeRecepcionClient(async () => ({
      estado: "DEVUELTA",
      mensajes,
      httpStatus: 200,
      durationMs: 11,
      rawXmlSha256: "x",
      reclassifiedFromDevuelta: false,
    }));
    const autorizacion = new FakeAutorizacionClient(async () => {
      throw new Error("autorización must NOT be called on DEVUELTA");
    });
    const result = await emitFactura(
      {
        prisma,
        blobStore: new InMemoryBlobStore(),
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );
    expect(result.document.estado).toBe("DEVUELTA");
    expect(autorizacion.calls).toBe(0);
    const events = await prisma.sriEvent.findMany({
      where: { documentId, estado: "DEVUELTA" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.mensajesJson).toEqual(mensajes);
  });
});

describe("emitFactura — EN_PROCESO path", () => {
  const ctx = useTestSchema();

  it("records EN_PROCESO with nextPollAt set; subsequent emit polls again", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000111",
    });

    const recepcion = new FakeRecepcionClient(async () => ({
      estado: "RECIBIDA",
      mensajes: [],
      httpStatus: 200,
      durationMs: 9,
      rawXmlSha256: "x",
      reclassifiedFromDevuelta: false,
    }));
    let firstQuery = true;
    const autorizacion = new FakeAutorizacionClient(async () => {
      if (firstQuery) {
        firstQuery = false;
        return {
          estado: "EN_PROCESO",
          ambiente: "PRUEBAS",
          mensajes: [],
          httpStatus: 200,
          durationMs: 5,
          rawXmlSha256: "x",
        };
      }
      return {
        estado: "AUTORIZADO",
        numeroAutorizacion: "AUTH-FINAL",
        fechaAutorizacion: new Date("2026-05-21T01:30:00Z").toISOString(),
        ambiente: "PRUEBAS",
        autorizadoXml: "<comprobante>done</comprobante>",
        mensajes: [],
        httpStatus: 200,
        durationMs: 5,
        rawXmlSha256: "x",
      };
    });

    const now = new Date("2026-05-21T01:00:00Z");
    const blobStore = new InMemoryBlobStore();
    const r1 = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
        now: () => now,
        initialPollDelayMs: 30_000,
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );
    expect(r1.document.estado).toBe("EN_PROCESO");
    expect(r1.document.nextPollAt).toBeInstanceOf(Date);
    expect(r1.document.nextPollAt!.getTime()).toBe(now.getTime() + 30_000);

    // A second emit picks up from EN_PROCESO and reaches AUTORIZADO via
    // the second autorización response.
    const r2 = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId },
    );
    expect(r2.document.estado).toBe("AUTORIZADO");
    expect(r2.document.numeroAutorizacion).toBe("AUTH-FINAL");
  });
});

describe("emitFactura — ERROR_RED transient send failure", () => {
  const ctx = useTestSchema();

  it("records ERROR_RED and a second emit recovers to AUTORIZADO", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000112",
    });

    let callCount = 0;
    const recepcion = new FakeRecepcionClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new SriClientError("simulated network", {
          kind: "network",
          transient: true,
        });
      }
      return {
        estado: "RECIBIDA",
        mensajes: [],
        httpStatus: 200,
        durationMs: 10,
        rawXmlSha256: "x",
        reclassifiedFromDevuelta: false,
      };
    });
    const autorizacion = new FakeAutorizacionClient(async () => ({
      estado: "AUTORIZADO",
      numeroAutorizacion: "AUTH-RECOV",
      fechaAutorizacion: new Date().toISOString(),
      ambiente: "PRUEBAS",
      autorizadoXml: "<comprobante/>",
      mensajes: [],
      httpStatus: 200,
      durationMs: 5,
      rawXmlSha256: "x",
    }));
    const blobStore = new InMemoryBlobStore();

    const r1 = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );
    expect(r1.document.estado).toBe("ERROR_RED");

    // Second attempt — same orchestrator, no fresh BUILD, just re-sends.
    const r2 = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId },
    );
    expect(r2.document.estado).toBe("AUTORIZADO");
  });
});

describe("emitFactura — ERROR_BUILD", () => {
  const ctx = useTestSchema();

  it("records ERROR_BUILD when the factura input fails Zod", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000113",
    });

    const recepcion = new FakeRecepcionClient(async () => {
      throw new Error("recepción must NOT be called on ERROR_BUILD");
    });
    const autorizacion = new FakeAutorizacionClient(async () => {
      throw new Error("autorización must NOT be called on ERROR_BUILD");
    });

    const result = await emitFactura(
      {
        prisma,
        blobStore: new InMemoryBlobStore(),
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: { not: "a factura" } },
    );
    expect(result.document.estado).toBe("ERROR_BUILD");
    expect(recepcion.calls).toBe(0);
    expect(autorizacion.calls).toBe(0);
  });
});

describe("emitFactura — idempotency on terminal state", () => {
  const ctx = useTestSchema();

  it("a second call on AUTORIZADO is a no-op (no new events)", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    await seedActiveCert({ prisma, companyId });
    const { documentId } = await seedPending({
      prisma,
      companyId,
      secuencial: "000000114",
    });
    const recepcion = new FakeRecepcionClient(async () => ({
      estado: "RECIBIDA",
      mensajes: [],
      httpStatus: 200,
      durationMs: 5,
      rawXmlSha256: "x",
      reclassifiedFromDevuelta: false,
    }));
    const autorizacion = new FakeAutorizacionClient(async () => ({
      estado: "AUTORIZADO",
      numeroAutorizacion: "AUTH-IDEM",
      fechaAutorizacion: new Date().toISOString(),
      ambiente: "PRUEBAS",
      autorizadoXml: "<comprobante/>",
      mensajes: [],
      httpStatus: 200,
      durationMs: 5,
      rawXmlSha256: "x",
    }));
    const blobStore = new InMemoryBlobStore();

    await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );
    const eventsBefore = await prisma.sriEvent.findMany({
      where: { documentId },
    });

    const r2 = await emitFactura(
      {
        prisma,
        blobStore,
        stubMode: false,
        recepcionClient: asRecepcionClient(recepcion),
        autorizacionClient: asAutorizacionClient(autorizacion),
      },
      { documentId, facturaInput: loadGoldenFacturaInput() },
    );
    expect(r2.didWork).toBe(false);
    expect(r2.document.estado).toBe("AUTORIZADO");
    const eventsAfter = await prisma.sriEvent.findMany({
      where: { documentId },
    });
    expect(eventsAfter.length).toBe(eventsBefore.length);
    // Crucially, the SOAP clients are NOT called on the second invocation.
    expect(recepcion.calls).toBe(1);
    expect(autorizacion.calls).toBe(1);
  });
});
