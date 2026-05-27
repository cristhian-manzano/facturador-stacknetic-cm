/**
 * Integration tests for `POST /v1/documents/:claveAcceso/resend`
 * (SPEC-0026 §FR-3 + PROMPT-0026 §5 "reissue refusal").
 *
 *   - DEVUELTA / NO_AUTORIZADO / ERROR_BUILD → 422 + `code:"reissue_required"`.
 *   - AUTORIZADO → 200 (idempotent no-op).
 *   - ERROR_RED → 200 with the document re-entering the orchestrator.
 *
 * The tests run against the apps/sri-core app factory in stub mode for
 * the AUTORIZADO + reissue-required cases (no SOAP traffic). The
 * ERROR_RED recovery test seeds the document in ERROR_RED and uses a
 * programmable RecepcionClient + AutorizacionClient.
 */
import request from "supertest";
import { ulid } from "ulid";
import { describe, expect, it } from "vitest";

import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { computeClaveAccesoCheckDigit } from "@facturador/contracts/primitives";
import type { SriEstado } from "@facturador/db";
import { useTestSchema } from "@facturador/db/test-harness";
import { mintServiceJwt } from "@facturador/utils/service-jwt";

import type {
  AutorizacionClient,
  AutorizacionResult,
  QueryAutorizacionInput,
  RecepcionClient,
  RecepcionResult,
  SendRecepcionInput,
} from "../src/soap/index.js";

import { createTestApp } from "./factory.js";

const SECRET = "resend-test-service-jwt-secret-32-chars-of-entropy_padding";

const claveAccesoFor = (sec: string): string => {
  const base48 =
    "21052026" + "01" + "1790012345001" + "1" + "001001" + sec.padStart(9, "0") + "12345678" + "1";
  return base48 + computeClaveAccesoCheckDigit(base48);
};

async function seedCompany(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
}): Promise<void> {
  await args.prisma.company.create({
    data: {
      id: args.companyId,
      ruc: "1790012345001",
      razonSocial: "Resend Test Co",
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Quito, Ecuador",
    },
  });
}

async function seedDoc(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
  estado: SriEstado;
  secuencial: string;
}): Promise<string> {
  const id = ulid();
  await args.prisma.sriDocument.create({
    data: {
      id,
      companyId: args.companyId,
      tipoComprobante: "01",
      claveAcceso: claveAccesoFor(args.secuencial),
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: args.secuencial.padStart(9, "0"),
      fechaEmision: new Date("2026-05-21T00:00:00Z"),
      estado: args.estado,
    },
  });
  return id;
}

class FakeRecepcionClient {
  public constructor(
    private readonly impl: (input: SendRecepcionInput) => Promise<RecepcionResult>,
  ) {}
  async send(input: SendRecepcionInput): Promise<RecepcionResult> {
    return this.impl(input);
  }
  urlFor(): string {
    return "http://fake";
  }
}
class FakeAutorizacionClient {
  public constructor(
    private readonly impl: (input: QueryAutorizacionInput) => Promise<AutorizacionResult>,
  ) {}
  async query(input: QueryAutorizacionInput): Promise<AutorizacionResult> {
    return this.impl(input);
  }
  urlFor(): string {
    return "http://fake";
  }
}

describe("POST /v1/documents/:claveAcceso/resend — reissue refusal", () => {
  const ctx = useTestSchema();

  it.each<[SriEstado]>([["DEVUELTA"], ["NO_AUTORIZADO"], ["ERROR_BUILD"]])(
    "%s returns 422 + code:'reissue_required'",
    async (estado) => {
      const { app } = createTestApp({
        prisma: ctx.getPrisma(),
        serviceJwtSecret: SECRET,
        stubMode: true,
      });
      const companyId = ulid();
      const token = await mintServiceJwt({ companyId, secret: SECRET });
      const secuencial = `0000003${(estado.length + 10).toString().padStart(2, "0")}`;
      await seedDoc({
        prisma: ctx.getPrisma(),
        companyId,
        estado,
        secuencial,
      });
      const ca = claveAccesoFor(secuencial);
      const res = await request(app)
        .post(`/v1/documents/${ca}/resend`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(422);
      const problem = ProblemDetailSchema.parse(res.body);
      expect(problem.code).toBe("reissue_required");
    },
  );

  it("AUTORIZADO returns 200 idempotently", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const secuencial = "000000320";
    await seedDoc({
      prisma: ctx.getPrisma(),
      companyId,
      estado: "AUTORIZADO",
      secuencial,
    });
    const ca = claveAccesoFor(secuencial);
    const res = await request(app)
      .post(`/v1/documents/${ca}/resend`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("AUTORIZADO");
  });

  it("404 when the doc doesn't belong to this tenant", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const ownerCompanyId = ulid();
    const otherCompanyId = ulid();
    const otherToken = await mintServiceJwt({ companyId: otherCompanyId, secret: SECRET });
    const secuencial = "000000330";
    await seedDoc({
      prisma: ctx.getPrisma(),
      companyId: ownerCompanyId,
      estado: "ERROR_RED",
      secuencial,
    });
    const ca = claveAccesoFor(secuencial);
    const res = await request(app)
      .post(`/v1/documents/${ca}/resend`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/documents/:claveAcceso/resend — ERROR_RED recovery", () => {
  const ctx = useTestSchema();

  it("re-enters the orchestrator and reaches AUTORIZADO", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedCompany({ prisma, companyId });
    // Seed an ERROR_RED doc with a signed XML key set so the orchestrator's
    // SEND step can resume without re-signing.
    const id = ulid();
    const secuencial = "000000400";
    const ca = claveAccesoFor(secuencial);
    await prisma.sriDocument.create({
      data: {
        id,
        companyId,
        tipoComprobante: "01",
        claveAcceso: ca,
        ambiente: "1",
        estab: "001",
        ptoEmi: "001",
        secuencial,
        fechaEmision: new Date("2026-05-21T00:00:00Z"),
        estado: "ERROR_RED",
        signedXmlBlobKey: `${companyId}/${id}/signed.xml`,
      },
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
      numeroAutorizacion: "AUTH-RECOV",
      fechaAutorizacion: new Date().toISOString(),
      ambiente: "PRUEBAS",
      autorizadoXml: "<comprobante/>",
      mensajes: [],
      httpStatus: 200,
      durationMs: 5,
      rawXmlSha256: "x",
    }));
    const harness = createTestApp({
      prisma,
      serviceJwtSecret: SECRET,
      stubMode: false,
      recepcionClient: recepcion as unknown as RecepcionClient,
      autorizacionClient: autorizacion as unknown as AutorizacionClient,
    });
    // Pre-seed the signed blob so the orchestrator finds it.
    await harness.blobStore.put(`${companyId}/${id}/signed.xml`, "<factura/>");

    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const res = await request(harness.app)
      .post(`/v1/documents/${ca}/resend`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("AUTORIZADO");
  });
});
