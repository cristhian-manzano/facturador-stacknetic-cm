/**
 * Contract round-trip test for `GET /api/v1/invoices/:id`.
 *
 * Asserts that the server's response body parses cleanly against
 * `InvoiceDetailSchema` from `@facturador/contracts/invoices`. The web detail
 * page consumes the response through this exact schema (see
 * `apps/web/src/invoices/api.ts::getInvoiceDetail`), so a schema mismatch
 * here is a production-breaking bug.
 *
 * Two scenarios:
 *
 *   1. BORRADOR (no claveAcceso): no sri-core call is made and the response
 *      carries `sriDocument: null` + `sriEvents: []`.
 *   2. EMITIDO (with claveAcceso): the handler hydrates the SriDocument +
 *      timeline by calling sri-core. We MSW-stub the `/v1/documents/:clave/
 *      status` response so the test stays in-process.
 *
 * The success criterion is identical in both cases: the body MUST parse
 * against `InvoiceDetailSchema` with no errors.
 */
import { http, HttpResponse } from "msw";
import request from "supertest";
import { ulid } from "ulid";
import { afterEach, describe, expect, it } from "vitest";

import { InvoiceDetailSchema } from "@facturador/contracts/invoices";
import { useTestSchema } from "@facturador/db/test-harness";
import type { Role } from "@facturador/utils/rbac";

import { hashPassword } from "../src/auth/password.js";

import { createTestApp } from "./factory.js";
import { mswServer } from "./msw/server.js";

const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";
const PASSWORD = "DetailContract!123";

const SRI_CORE_TEST_URL = "http://sri-core.test";
const SERVICE_JWT_TEST_SECRET = "test-secret-test-secret-test-secret-1234567890";

// Synthetic RUC pool (province 99 — SRI reserved test space).
const TENANT_RUCS: readonly string[] = [
  "9990000015001",
  "9990000023001",
  "9990000031001",
  "9990000041001",
];
let tenantRucCursor = 0;
function nextTenantRuc(): string {
  const value = TENANT_RUCS[tenantRucCursor % TENANT_RUCS.length];
  tenantRucCursor += 1;
  if (value === undefined) throw new Error("Tenant RUC pool exhausted");
  return value;
}

afterEach(() => {
  mswServer.resetHandlers();
});

// ---------------------------------------------------------------------------
// HTTP + seed helpers — mirrored from invoices.test.ts so this file stays
// self-contained.
// ---------------------------------------------------------------------------

function extractCookieValue(setCookieHeader: string[] | undefined, name: string): string {
  if (setCookieHeader === undefined) {
    throw new Error(`No Set-Cookie present (expected ${name})`);
  }
  for (const line of setCookieHeader) {
    const [pair] = line.split(";");
    if (pair === undefined) continue;
    const [k, v] = pair.split("=");
    if (k === name && v !== undefined && v.length > 0) return v;
  }
  throw new Error(`Cookie ${name} not found in Set-Cookie`);
}

async function seedUser(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  emailPrefix: string,
): Promise<{ userId: string; email: string; password: string }> {
  const id = ulid();
  const email = `${emailPrefix}-${id.toLowerCase()}@example.test`;
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.create({
    data: { id, email, passwordHash, displayName: emailPrefix },
  });
  return { userId: id, email, password: PASSWORD };
}

async function seedTenant(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  ruc: string,
  razonSocial: string,
): Promise<{ companyId: string }> {
  const id = ulid();
  await prisma.company.create({
    data: {
      id,
      ruc,
      razonSocial,
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Av. Amazonas N20-20",
    },
  });
  return { companyId: id };
}

async function attachMembership(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  userId: string,
  companyId: string,
  role: Role,
): Promise<void> {
  await prisma.membership.create({
    data: { id: ulid(), userId, companyId, role, acceptedAt: new Date() },
  });
}

async function loginAndGetCookies(
  app: import("express").Express,
  email: string,
  password: string,
): Promise<{ sessionId: string; csrfToken: string }> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"] as string[] | undefined;
  const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
  const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);
  return { sessionId, csrfToken };
}

async function switchTenant(
  app: import("express").Express,
  sessionId: string,
  csrfToken: string,
  companyId: string,
): Promise<{ csrf: string }> {
  const res = await request(app)
    .post("/api/v1/session/tenant")
    .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
    .set("x-csrf-token", csrfToken)
    .send({ companyId });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"] as string[] | undefined;
  const csrf = extractCookieValue(setCookie, CSRF_COOKIE);
  return { csrf };
}

async function seedEmissionPoint(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  companyId: string,
): Promise<{ emissionPointId: string }> {
  const estId = ulid();
  await prisma.establecimiento.create({
    data: {
      id: estId,
      companyId,
      codigo: "001",
      direccion: "Av. Amazonas N20-20",
      isMatriz: true,
    },
  });
  const epId = ulid();
  await prisma.emissionPoint.create({
    data: {
      id: epId,
      companyId,
      establecimientoId: estId,
      codigo: "001",
      descripcion: "Caja Principal",
      isDefault: true,
    },
  });
  return { emissionPointId: epId };
}

async function seedCustomer(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  companyId: string,
): Promise<{ customerId: string }> {
  const id = ulid();
  await prisma.customer.create({
    data: {
      id,
      companyId,
      tipoIdentificacion: "06",
      identificacion: "X12345678",
      razonSocial: "Detail Contract Customer",
      direccion: "Av. de los Shyris N32-100",
    },
  });
  return { customerId: id };
}

async function authenticatedSession(
  app: import("express").Express,
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  emailPrefix: string,
): Promise<{
  userId: string;
  companyId: string;
  sessionId: string;
  csrf: string;
  emissionPointId: string;
  customerId: string;
}> {
  const u = await seedUser(prisma, emailPrefix);
  const t = await seedTenant(prisma, nextTenantRuc(), `${emailPrefix.toUpperCase()} S.A.`);
  await attachMembership(prisma, u.userId, t.companyId, "OWNER");
  const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
  const { csrf } = await switchTenant(app, sessionId, csrfToken, t.companyId);
  const { emissionPointId } = await seedEmissionPoint(prisma, t.companyId);
  const { customerId } = await seedCustomer(prisma, t.companyId);
  return {
    userId: u.userId,
    companyId: t.companyId,
    sessionId,
    csrf,
    emissionPointId,
    customerId,
  };
}

function authCookieHeader(sessionId: string, csrf: string): string {
  return `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`;
}

function validInvoiceBody(params: {
  emissionPointId: string;
  customerId: string;
}): Record<string, unknown> {
  return {
    emissionPointId: params.emissionPointId,
    customerId: params.customerId,
    fechaEmision: "2026-05-20",
    lines: [
      {
        descripcion: "Servicio A",
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
      },
    ],
    payments: [{ formaPago: "01", total: 115 }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/invoices/:id — contract round-trip vs InvoiceDetailSchema", () => {
  const ctx = useTestSchema();

  it("BORRADOR detail (no claveAcceso) parses against InvoiceDetailSchema", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-detail-borrador");

    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: auth.emissionPointId,
          customerId: auth.customerId,
        }),
      );
    expect(create.status).toBe(201);
    const id = (create.body as { id: string }).id;

    const detail = await request(app)
      .get(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));

    expect(detail.status).toBe(200);
    const parsed = InvoiceDetailSchema.safeParse(detail.body);
    if (!parsed.success) {
      // Surface the Zod issues so failures are debuggable.
      throw new Error(
        `InvoiceDetailSchema.parse failed:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.success).toBe(true);
    expect(parsed.data.invoice.id).toBe(id);
    expect(parsed.data.invoice.estado).toBe("BORRADOR");
    expect(parsed.data.invoice.claveAcceso).toBeNull();
    expect(parsed.data.sriDocument).toBeNull();
    expect(parsed.data.sriEvents).toEqual([]);
    expect(parsed.data.customer.id).toBe(auth.customerId);
  });

  it("EMITIDO detail (with claveAcceso) hydrates sriDocument + sriEvents and parses against the schema", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-detail-emitido");

    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: auth.emissionPointId,
          customerId: auth.customerId,
        }),
      );
    expect(create.status).toBe(201);
    const id = (create.body as { id: string }).id;

    // Force EMITIDO + a known clave-acceso directly in the DB. We don't go
    // through the orchestrator here — the contract round-trip is about the
    // detail response shape, not the emit pipeline. The clave below has a
    // valid mod-11 verifier digit (reused from factura-input.test.ts).
    const claveAcceso = "1905202601999000001500110010010000000011234567811";
    const docId = ulid();
    await prisma.invoice.update({
      where: { id },
      data: {
        estado: "EMITIDO",
        claveAcceso,
        secuencial: "000000001",
        sriEstado: "AUTORIZADO",
        sriDocumentId: docId,
        numeroAutorizacion: "AUTH-12345",
        emittedAt: new Date(),
      },
    });

    // MSW: stub sri-core /v1/documents/:claveAcceso/status with a body that
    // matches DocumentStatusResponseSchema.
    mswServer.use(
      http.get(`${SRI_CORE_TEST_URL}/v1/documents/:claveAcceso/status`, () => {
        return HttpResponse.json({
          document: {
            id: docId,
            companyId: auth.companyId,
            claveAcceso,
            ambiente: "1",
            codDoc: "01",
            estab: "001",
            ptoEmi: "001",
            secuencial: "000000001",
            fechaEmision: "2026-05-19",
            estado: "AUTORIZADO",
            numeroAutorizacion: "AUTH-12345",
            fechaAutorizacion: "2026-05-20T15:30:00.000Z",
            createdAt: "2026-05-20T15:00:00.000Z",
            updatedAt: "2026-05-20T15:30:00.000Z",
          },
          events: [
            {
              id: ulid(),
              documentId: docId,
              etapa: "BUILD",
              estado: "PENDIENTE",
              mensajes: [],
              durationMs: 12,
              createdAt: "2026-05-20T15:00:00.000Z",
            },
            {
              id: ulid(),
              documentId: docId,
              etapa: "AUTHORIZE",
              estado: "AUTORIZADO",
              mensajes: [],
              durationMs: 540,
              createdAt: "2026-05-20T15:30:00.000Z",
            },
          ],
        });
      }),
    );

    const detail = await request(app)
      .get(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));

    expect(detail.status).toBe(200);
    const parsed = InvoiceDetailSchema.safeParse(detail.body);
    if (!parsed.success) {
      throw new Error(
        `InvoiceDetailSchema.parse failed:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.success).toBe(true);
    expect(parsed.data.invoice.id).toBe(id);
    expect(parsed.data.invoice.estado).toBe("EMITIDO");
    expect(parsed.data.invoice.claveAcceso).toBe(claveAcceso);
    expect(parsed.data.sriDocument).not.toBeNull();
    expect(parsed.data.sriDocument?.estado).toBe("AUTORIZADO");
    expect(parsed.data.sriEvents).toHaveLength(2);
  });
});
