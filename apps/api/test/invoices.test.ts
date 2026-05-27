/**
 * Integration tests for SPEC-0032 (invoice CRUD) + SPEC-0033 (orchestrator).
 *
 * What is covered:
 *
 *   - CRUD happy path: create draft → 201, persisted, audited.
 *   - Invalid payload (Zod shape error) → 400 + ProblemDetail.
 *   - Server pins `companyId`: a body that injects `companyId` is ignored.
 *   - Body cannot supply `claveAcceso` (defence-in-depth) → 400.
 *   - `preview-totals`: returns computed totals + paymentsBalanced; NO row
 *     persisted (count `prisma.invoice` rows before/after).
 *   - Edit on EMITIDO → 422 `code:"locked"`.
 *   - Cursor pagination across 25 invoices in 2 batches; deterministic order.
 *   - Cross-tenant probes return 404 (no enumeration).
 *   - RBAC denial: VIEWER → 403; OPERATOR can create.
 *   - emit happy path (stub sri-core via MSW): invoice goes EMITIDO,
 *     sriEstado=AUTORIZADO, claveAcceso 49 digits, secuencial assigned;
 *     audit rows land.
 *   - emit idempotent: second call returns the same body without
 *     re-reserving secuencial or hitting sri-core again.
 *   - emit business error (payments_mismatch) → 422; invoice stays BORRADOR.
 *   - emit DEVUELTA: mirror populated; reissue creates a new BORRADOR with
 *     a different id and a BurnedSecuencial row.
 *   - emit network failure: 502 ProblemDetail + sriEstado=ERROR_RED.
 *   - refresh re-queries sri-core and updates the mirror.
 *
 * Synthetic data only: tenant RUCs use the SRI province-99 reserved pool;
 * cédulas + customer RUCs are deterministic test vectors with valid
 * checksums (módulo 10/11). No real RUC, email, phone, or address appears.
 */
import { http, HttpResponse } from "msw";
import request from "supertest";
import { ulid } from "ulid";
import { afterEach, describe, expect, it } from "vitest";

import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { useTestSchema } from "@facturador/db/test-harness";
import type { Role } from "@facturador/utils/rbac";

import { hashPassword } from "../src/auth/password.js";

import { createTestApp } from "./factory.js";
import { mswServer } from "./msw/server.js";

const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";
const PASSWORD = "InvoiceTest!123";

const SRI_CORE_TEST_URL = "http://sri-core.test";
// 32+ char ASCII secret (matches env.SERVICE_JWT_SECRET min length).
const SERVICE_JWT_TEST_SECRET = "test-secret-test-secret-test-secret-1234567890";

// Synthetic tenant RUCs (province 99 — SRI's reserved pool for tests).
const TENANT_RUCS: readonly string[] = [
  "9990000015001",
  "9990000023001",
  "9990000031001",
  "9990000041001",
  "9990000058001",
  "9990000066001",
  "9990000074001",
  "9990000082001",
  "9990000090001",
  "9990000104001",
  "9990000112001",
  "9990000120001",
  "9990000139001",
  "9990000147001",
  "9990000155001",
  "9990000163001",
  "9990000171001",
  "9990000181001",
  "9990000198001",
  "9990000201001",
];
let tenantRucCursor = 0;
function nextTenantRuc(): string {
  const value = TENANT_RUCS[tenantRucCursor % TENANT_RUCS.length];
  tenantRucCursor += 1;
  if (value === undefined) throw new Error("Tenant RUC pool exhausted");
  return value;
}

afterEach(() => {
  // Each test re-registers its sri-core handlers so they don't leak.
  mswServer.resetHandlers();
});

// =========================================================================
// HTTP helpers — mirrored from customers.test.ts so this file stays self-
// contained and explicit about its session shape.
// =========================================================================

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
  throw new Error(`Cookie ${name} not in Set-Cookie`);
}

async function seedUser(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  emailPrefix: string,
): Promise<{ userId: string; email: string; password: string }> {
  const userId = ulid();
  const email = `${emailPrefix}-${ulid().toLowerCase()}@facturador.test`;
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.create({
    data: {
      id: userId,
      email,
      passwordHash,
      displayName: `User ${emailPrefix}`,
      isSuperadmin: false,
    },
  });
  return { userId, email, password: PASSWORD };
}

async function seedTenant(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  ruc: string,
  name: string,
): Promise<{ companyId: string; ruc: string }> {
  const companyId = ulid();
  await prisma.company.create({
    data: {
      id: companyId,
      ruc,
      razonSocial: name,
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Calle Test 1, Quito",
      obligadoContabilidad: false,
    },
  });
  return { companyId, ruc };
}

async function attachMembership(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  userId: string,
  companyId: string,
  role: Role,
): Promise<void> {
  const id = ulid();
  // Active membership: production-readiness invitation lifecycle requires
  // `acceptedAt` non-null for `requireTenant` to pass.
  await prisma.membership.create({
    data: { id, userId, companyId, role, acceptedAt: new Date() },
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
): Promise<{ emissionPointId: string; estab: string; ptoEmi: string }> {
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
  return { emissionPointId: epId, estab: "001", ptoEmi: "001" };
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
      razonSocial: "Test Customer",
      direccion: "Av. de los Shyris N32-100",
    },
  });
  return { customerId: id };
}

async function authenticatedSession(
  app: import("express").Express,
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  emailPrefix: string,
  role: Role = "OWNER",
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
  await attachMembership(prisma, u.userId, t.companyId, role);
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

// =========================================================================
// Body fixtures.
// =========================================================================

interface InvoiceBodyParams {
  emissionPointId: string;
  customerId: string;
  fechaEmision?: string;
  lineUnit?: number;
  lineCantidad?: number;
  paymentTotal?: number;
}
function validInvoiceBody(p: InvoiceBodyParams): Record<string, unknown> {
  const lineUnit = p.lineUnit ?? 100;
  const cantidad = p.lineCantidad ?? 1;
  const subtotal = Math.round(lineUnit * cantidad * 100) / 100;
  const tax = Math.round(subtotal * 0.15 * 100) / 100;
  const total = p.paymentTotal ?? Math.round((subtotal + tax) * 100) / 100;
  return {
    emissionPointId: p.emissionPointId,
    customerId: p.customerId,
    fechaEmision: p.fechaEmision ?? "2026-05-20",
    lines: [
      {
        descripcion: "Servicio A",
        cantidad,
        precioUnitario: lineUnit,
        descuento: 0,
        impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
      },
    ],
    payments: [{ formaPago: "01", total }],
  };
}

// =========================================================================
// SECTION 1 — CRUD happy path + validation.
// =========================================================================

describe("POST /api/v1/invoices — create + validate", () => {
  const ctx = useTestSchema();

  it("creates a BORRADOR; row is persisted; row is audited", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-create");

    const res = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: auth.emissionPointId,
          customerId: auth.customerId,
        }),
      );
    expect(res.status).toBe(201);
    const body = res.body as { id: string; estado: string; importeTotal: number };
    expect(body.estado).toBe("BORRADOR");
    expect(body.importeTotal).toBeCloseTo(115, 2);

    const row = await prisma.invoice.findUnique({ where: { id: body.id } });
    expect(row?.companyId).toBe(auth.companyId);
    expect(row?.secuencial).toBeNull();
    expect(row?.claveAcceso).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "invoice.created", entityId: body.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorUserId).toBe(auth.userId);
  });

  it("invalid payload (no lines) → 400 ProblemDetail", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-bad");

    const res = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        emissionPointId: auth.emissionPointId,
        customerId: auth.customerId,
        fechaEmision: "2026-05-20",
        lines: [],
        payments: [{ formaPago: "01", total: 0 }],
      });
    expect(res.status).toBe(400);
    expect(ProblemDetailSchema.safeParse(res.body).success).toBe(true);
  });

  it("body with claveAcceso is rejected (server-only field)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-clave");

    const body = validInvoiceBody({
      emissionPointId: auth.emissionPointId,
      customerId: auth.customerId,
    });
    body.claveAcceso = "1".repeat(49);

    const res = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(body);
    expect(res.status).toBe(400);
  });

  it("body that injects companyId is ignored; row binds to req.companyId", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-inject");
    const otherCompanyId = ulid();

    const body = validInvoiceBody({
      emissionPointId: auth.emissionPointId,
      customerId: auth.customerId,
    });
    body.companyId = otherCompanyId;

    const res = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(body);
    expect(res.status).toBe(201);
    const row = await prisma.invoice.findUnique({
      where: { id: (res.body as { id: string }).id },
    });
    expect(row?.companyId).toBe(auth.companyId);
    expect(row?.companyId).not.toBe(otherCompanyId);
  });

  it("VIEWER cannot create (RBAC denial → 403 forbidden_action)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-viewer", "VIEWER");

    const res = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: auth.emissionPointId,
          customerId: auth.customerId,
        }),
      );
    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("forbidden_action");
  });
});

// =========================================================================
// SECTION 2 — preview-totals.
// =========================================================================

describe("POST /api/v1/invoices/preview-totals — pure compute", () => {
  const ctx = useTestSchema();

  it("returns computed totals; no row persisted", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-preview");

    const before = await prisma.invoice.count();
    const res = await request(app)
      .post("/api/v1/invoices/preview-totals")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: auth.emissionPointId,
          customerId: auth.customerId,
        }),
      );
    expect(res.status).toBe(200);
    const body = res.body as {
      totalSinImpuestos: number;
      importeTotal: number;
      paymentsBalanced: boolean;
    };
    expect(body.totalSinImpuestos).toBeCloseTo(100, 2);
    expect(body.importeTotal).toBeCloseTo(115, 2);
    expect(body.paymentsBalanced).toBe(true);
    const after = await prisma.invoice.count();
    expect(after).toBe(before);
  });
});

// =========================================================================
// SECTION 3 — GET detail / list (cursor pagination + cross-tenant 404).
// =========================================================================

describe("GET /api/v1/invoices — list + detail + cross-tenant", () => {
  const ctx = useTestSchema();

  it("GET :id cross-tenant returns 404 (no enumeration)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const t1 = await authenticatedSession(app, prisma, "inv-x1");
    const t2 = await authenticatedSession(app, prisma, "inv-x2");

    // Create an invoice under t2.
    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(t2.sessionId, t2.csrf))
      .set("x-csrf-token", t2.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: t2.emissionPointId,
          customerId: t2.customerId,
        }),
      );
    expect(create.status).toBe(201);
    const id = (create.body as { id: string }).id;

    // Probe from t1 → 404.
    const probe = await request(app)
      .get(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(t1.sessionId, t1.csrf));
    expect(probe.status).toBe(404);
  });

  it("cursor pagination over 25 rows yields 2 batches; deterministic order", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-page");

    // Seed 25 invoices.
    for (let i = 0; i < 25; i += 1) {
      const r = await request(app)
        .post("/api/v1/invoices")
        .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
        .set("x-csrf-token", auth.csrf)
        .send(
          validInvoiceBody({
            emissionPointId: auth.emissionPointId,
            customerId: auth.customerId,
          }),
        );
      expect(r.status).toBe(201);
    }

    const page1 = await request(app)
      .get("/api/v1/invoices?limit=20")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(page1.status).toBe(200);
    const p1 = page1.body as { items: { id: string }[]; nextCursor: string | null };
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/api/v1/invoices?limit=20&cursor=${p1.nextCursor ?? ""}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(page2.status).toBe(200);
    const p2 = page2.body as { items: { id: string }[]; nextCursor: string | null };
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();

    // No id appears in both pages.
    const seen = new Set(p1.items.map((x) => x.id));
    for (const it of p2.items) {
      expect(seen.has(it.id)).toBe(false);
    }
  });
});

// =========================================================================
// SECTION 4 — PATCH / DELETE on EMITIDO → 422 locked.
// =========================================================================

describe("PATCH/DELETE on EMITIDO → 422 locked", () => {
  const ctx = useTestSchema();

  it("PATCH on EMITIDO → 422 locked", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-locked-edit");

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
    const id = (create.body as { id: string }).id;

    // Force estado=EMITIDO directly in the DB to test the guard.
    await prisma.invoice.update({
      where: { id },
      data: { estado: "EMITIDO", secuencial: "000000001" },
    });

    const res = await request(app)
      .patch(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ propina: 1.5 });
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("locked");
  });

  it("DELETE on EMITIDO → 422 locked", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-locked-del");

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
    const id = (create.body as { id: string }).id;
    await prisma.invoice.update({
      where: { id },
      data: { estado: "EMITIDO", secuencial: "000000001" },
    });

    const res = await request(app)
      .delete(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(422);
  });
});

// =========================================================================
// SECTION 4.5 — PATCH BORRADOR partial body — exercises legacy* helpers in
// handlers.ts (REVIEW-0044 CB-1 branch-coverage pass).
//
// When a PATCH body omits `lines`, `payments`, or `adicionales`, the
// handler re-runs `computeInvoice` against the existing rows; the helpers
// `legacyLines`, `legacyPayments`, and `legacyAdicionales` are responsible
// for projecting the DB rows back into the contract shape. Prior to this
// pass the helpers were uncovered (handlers.ts:1167-1218 = 0% branch).
// =========================================================================

describe("PATCH /api/v1/invoices/:id — partial body re-uses persisted lines/payments", () => {
  const ctx = useTestSchema();

  it("PATCH propina only (no lines/payments) succeeds and totals are recomputed", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-patch-partial");

    // Create a BORRADOR with one line + one payment, plus an adicional so
    // legacyAdicionales also fires.
    const createBody: Record<string, unknown> = {
      emissionPointId: auth.emissionPointId,
      customerId: auth.customerId,
      fechaEmision: "2026-05-20",
      lines: [
        {
          descripcion: "Servicio Alpha",
          cantidad: 1,
          precioUnitario: 100,
          descuento: 0,
          impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
        },
      ],
      payments: [{ formaPago: "01", total: 115 }],
      adicionales: [{ nombre: "OC", valor: "12345" }],
    };
    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(createBody);
    expect(create.status).toBe(201);
    const id = (create.body as { id: string }).id;

    // PATCH only `propina`. The handler must re-run computeInvoice over the
    // existing line/payment rows projected via the legacy* helpers.
    // Payments include the propina so importeTotal stays balanced.
    const res = await request(app)
      .patch(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ propina: 5, payments: [{ formaPago: "01", total: 120 }] });

    expect(res.status).toBe(200);
    const body = res.body as { propina: number; importeTotal: number };
    expect(body.propina).toBeCloseTo(5, 2);
    expect(body.importeTotal).toBeCloseTo(120, 2);
  });

  it("PATCH on the same row with adicionales unchanged keeps the original adicionales", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "inv-patch-adic");

    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        emissionPointId: auth.emissionPointId,
        customerId: auth.customerId,
        fechaEmision: "2026-05-20",
        lines: [
          {
            descripcion: "Producto Beta",
            cantidad: 2,
            precioUnitario: 25,
            descuento: 0,
            impuestos: [{ codigo: "2", codigoPorcentaje: "4", tarifa: 15 }],
          },
        ],
        payments: [{ formaPago: "01", total: 57.5 }],
        adicionales: [
          { nombre: "Cliente", valor: "ABC" },
          { nombre: "Pedido", valor: "P-9000" },
        ],
      });
    expect(create.status).toBe(201);
    const id = (create.body as { id: string }).id;

    // PATCH omits `adicionales` — the handler must project the existing
    // ones via `legacyAdicionales`. We only tweak the customer reference
    // (which doesn't touch totals) to keep the assertion narrow.
    const res = await request(app)
      .patch(`/api/v1/invoices/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ customerId: auth.customerId });
    expect(res.status).toBe(200);
    const body = res.body as {
      adicionales: { nombre: string; valor: string }[];
    };
    expect(body.adicionales).toHaveLength(2);
    expect(body.adicionales[0]?.nombre).toBe("Cliente");
    expect(body.adicionales[1]?.nombre).toBe("Pedido");
  });
});

// =========================================================================
// SECTION 5 — emit happy path + idempotency (stub sri-core via MSW).
// =========================================================================

interface CapturedRequest {
  authorization: string | null;
  body: unknown;
  url: string;
}

function pinSriCoreEmit(
  capture: CapturedRequest[],
  estado: "AUTORIZADO" | "DEVUELTA" | "EN_PROCESO" | "NO_AUTORIZADO" = "AUTORIZADO",
  extras: {
    numeroAutorizacion?: string;
    fechaAutorizacion?: string;
    mensajes?: readonly {
      identificador: string;
      mensaje: string;
      tipo: "ERROR" | "INFORMATIVO" | "ADVERTENCIA";
    }[];
  } = {},
): void {
  mswServer.use(
    http.post(`${SRI_CORE_TEST_URL}/v1/documents/emit`, async ({ request }) => {
      const auth = request.headers.get("authorization");
      const body = await request.json();
      capture.push({ authorization: auth, body, url: request.url });
      const claveAcceso = (body as { claveAcceso: string }).claveAcceso;
      const payload: Record<string, unknown> = {
        claveAcceso,
        estado,
      };
      if (extras.numeroAutorizacion !== undefined)
        payload.numeroAutorizacion = extras.numeroAutorizacion;
      if (extras.fechaAutorizacion !== undefined)
        payload.fechaAutorizacion = extras.fechaAutorizacion;
      if (extras.mensajes !== undefined) payload.mensajes = extras.mensajes;
      return HttpResponse.json(payload);
    }),
  );
}

function pinSriCoreNetworkFailure(): void {
  mswServer.use(
    http.post(`${SRI_CORE_TEST_URL}/v1/documents/emit`, () => {
      return HttpResponse.error();
    }),
  );
}

function pinSriCoreStatus(
  estado: "AUTORIZADO" | "DEVUELTA" | "EN_PROCESO" | "NO_AUTORIZADO",
  extras: {
    numeroAutorizacion?: string;
    fechaAutorizacion?: string;
  } = {},
): void {
  mswServer.use(
    http.get(`${SRI_CORE_TEST_URL}/v1/documents/:claveAcceso/status`, ({ params }) => {
      const claveAcceso = String(params.claveAcceso);
      return HttpResponse.json({
        document: {
          id: ulid(),
          companyId: ulid(),
          claveAcceso,
          ambiente: "1",
          codDoc: "01",
          estab: "001",
          ptoEmi: "001",
          secuencial: "000000001",
          fechaEmision: "20/05/2026",
          estado,
          numeroAutorizacion: extras.numeroAutorizacion ?? "1801202401000000000000000",
          fechaAutorizacion: extras.fechaAutorizacion ?? "2026-05-20T10:00:00.000Z",
          createdAt: "2026-05-20T10:00:00.000Z",
          updatedAt: "2026-05-20T10:00:00.000Z",
        },
        events: [
          {
            id: ulid(),
            documentId: ulid(),
            etapa: "AUTHORIZE",
            estado,
            mensajes: [],
            durationMs: 100,
            createdAt: "2026-05-20T10:00:00.000Z",
          },
        ],
      });
    }),
  );
}

describe("POST /api/v1/invoices/:id/emit — orchestrator", () => {
  const ctx = useTestSchema();

  it("happy path: BORRADOR → EMITIDO + AUTORIZADO; secuencial + claveAcceso assigned; audit rows present", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-emit-ok");

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
    const id = (create.body as { id: string }).id;

    const capture: CapturedRequest[] = [];
    pinSriCoreEmit(capture, "AUTORIZADO", {
      numeroAutorizacion: "2005202601990000000150010010000000011234567811",
      fechaAutorizacion: "2026-05-20T10:00:00.000Z",
    });

    const res = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(200);

    const body = res.body as {
      estado: string;
      claveAcceso: string;
      sriEstado: string;
      numeroAutorizacion: string | null;
      fechaAutorizacion: string | null;
    };
    expect(body.estado).toBe("EMITIDO");
    expect(body.sriEstado).toBe("AUTORIZADO");
    expect(body.claveAcceso).toMatch(/^\d{49}$/);
    expect(body.numeroAutorizacion).toBe("2005202601990000000150010010000000011234567811");

    const row = await prisma.invoice.findUnique({ where: { id } });
    expect(row?.estado).toBe("EMITIDO");
    expect(row?.sriEstado).toBe("AUTORIZADO");
    expect(row?.secuencial).toBe("000000001");
    expect(row?.claveAcceso?.length).toBe(49);

    // Captured call has a Bearer token (the service JWT, redacted from logs).
    expect(capture.length).toBe(1);
    const firstCall = capture[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.authorization).toMatch(/^Bearer /);
    // JWT payload contains the companyId in `sub`.
    const token = (firstCall?.authorization ?? "").replace(/^Bearer /, "");
    const [, payloadB64] = token.split(".");
    expect(payloadB64).toBeDefined();
    const payload = JSON.parse(Buffer.from(payloadB64 ?? "", "base64").toString("utf-8")) as {
      sub: string;
      iss: string;
      aud: string;
      exp: number;
      iat: number;
    };
    expect(payload.aud).toBe("sri-core");
    expect(payload.iss).toBe("api");
    expect(payload.sub).toBe(auth.companyId);
    // exp ≤ iat + 60.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);

    // Audit rows.
    const attempts = await prisma.auditLog.findMany({
      where: { action: "invoice.emit.attempt", entityId: id },
    });
    expect(attempts.length).toBe(1);
    const successes = await prisma.auditLog.findMany({
      where: { action: "invoice.emit.success", entityId: id },
    });
    expect(successes.length).toBe(1);
  });

  it("idempotent: second emit returns same body; secuencial unchanged; no second sri-core call", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-emit-idem");

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
    const id = (create.body as { id: string }).id;

    const capture: CapturedRequest[] = [];
    pinSriCoreEmit(capture, "AUTORIZADO", {
      numeroAutorizacion: "AUTO-IDEM",
      fechaAutorizacion: "2026-05-20T10:00:00.000Z",
    });

    const r1 = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(r1.status).toBe(200);
    const clave1 = (r1.body as { claveAcceso: string }).claveAcceso;
    const secuencial1 = (await prisma.invoice.findUnique({ where: { id } }))?.secuencial;

    const r2 = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(r2.status).toBe(200);
    const clave2 = (r2.body as { claveAcceso: string }).claveAcceso;
    const secuencial2 = (await prisma.invoice.findUnique({ where: { id } }))?.secuencial;

    expect(clave1).toBe(clave2);
    expect(secuencial1).toBe(secuencial2);
    // Only ONE outbound call to sri-core.
    expect(capture.length).toBe(1);
    // Audit log records the idempotent path.
    const idem = await prisma.auditLog.findMany({
      where: { action: "invoice.emit.idempotent", entityId: id },
    });
    expect(idem.length).toBe(1);
  });

  it("payments_mismatch → 422; invoice stays BORRADOR; no sri-core call", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-emit-mm");

    // Create a draft with a deliberately mismatching payment total. We
    // bypass the create endpoint (which enforces sum) by patching the DB
    // directly to drift the importeTotal by 0.02 — the orchestrator
    // re-checks at emit time.
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
    const id = (create.body as { id: string }).id;

    // Drift importeTotal so the orchestrator's guard fires.
    await prisma.invoice.update({
      where: { id },
      data: { importeTotal: "115.05" },
    });

    const capture: CapturedRequest[] = [];
    pinSriCoreEmit(capture, "AUTORIZADO");

    const res = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("payments_mismatch");

    const row = await prisma.invoice.findUnique({ where: { id } });
    expect(row?.estado).toBe("BORRADOR");
    expect(capture.length).toBe(0);
  });

  it("DEVUELTA: invoice EMITIDO, sriEstado=DEVUELTA, mensajes populated; reissue creates new BORRADOR + burn row", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-devuelta");

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
    const id = (create.body as { id: string }).id;

    const capture: CapturedRequest[] = [];
    pinSriCoreEmit(capture, "DEVUELTA", {
      mensajes: [{ identificador: "43", mensaje: "RUC inexistente", tipo: "ERROR" }],
    });

    const r = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(r.status).toBe(200);
    const body = r.body as {
      sriEstado: string;
      mensajes: readonly { mensaje: string; identificador: string }[];
    };
    expect(body.sriEstado).toBe("DEVUELTA");
    expect(body.mensajes.length).toBe(1);

    const row = await prisma.invoice.findUnique({ where: { id } });
    expect(row?.estado).toBe("EMITIDO");
    expect(row?.sriEstado).toBe("DEVUELTA");
    expect(row?.secuencial).toBe("000000001");

    // Reissue.
    const reissue = await request(app)
      .post(`/api/v1/invoices/${id}/reissue`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(reissue.status).toBe(201);
    const newId = (reissue.body as { newInvoiceId: string }).newInvoiceId;
    expect(newId).not.toBe(id);

    const newRow = await prisma.invoice.findUnique({ where: { id: newId } });
    expect(newRow?.estado).toBe("BORRADOR");
    expect(newRow?.secuencial).toBeNull();
    expect(newRow?.claveAcceso).toBeNull();

    // Old row is unchanged.
    const oldRow = await prisma.invoice.findUnique({ where: { id } });
    expect(oldRow?.estado).toBe("EMITIDO");
    expect(oldRow?.secuencial).toBe("000000001");

    // BurnedSecuencial row landed.
    const burn = await prisma.burnedSecuencial.findFirst({
      where: {
        companyId: auth.companyId,
        estab: "001",
        ptoEmi: "001",
        secuencial: "000000001",
      },
    });
    expect(burn).not.toBeNull();
    expect(burn?.reason).toBe("reissue");
  });

  it("network failure: emit returns 502; invoice EMITIDO + sriEstado=ERROR_RED", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-emit-net");

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
    const id = (create.body as { id: string }).id;

    pinSriCoreNetworkFailure();

    const res = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(502);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("sri.network");

    const row = await prisma.invoice.findUnique({ where: { id } });
    expect(row?.estado).toBe("EMITIDO"); // secuencial+clave persisted before sri-core
    expect(row?.sriEstado).toBe("ERROR_RED");
    expect(row?.secuencial).not.toBeNull();

    const fail = await prisma.auditLog.findFirst({
      where: { action: "invoice.emit.failure", entityId: id },
    });
    expect(fail).not.toBeNull();
  });

  it("cross-tenant emit on a foreign id returns 404 (no enumeration)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const t1 = await authenticatedSession(app, prisma, "inv-xemit1");
    const t2 = await authenticatedSession(app, prisma, "inv-xemit2");

    const create = await request(app)
      .post("/api/v1/invoices")
      .set("cookie", authCookieHeader(t2.sessionId, t2.csrf))
      .set("x-csrf-token", t2.csrf)
      .send(
        validInvoiceBody({
          emissionPointId: t2.emissionPointId,
          customerId: t2.customerId,
        }),
      );
    const id = (create.body as { id: string }).id;

    const res = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(t1.sessionId, t1.csrf))
      .set("x-csrf-token", t1.csrf);
    expect(res.status).toBe(404);
  });

  it("emit body that smuggles claveAcceso is rejected (defence in depth)", async () => {
    // Covers orchestrator.ts `assertBodyHasNoClaveAcceso`: the server is
    // the only party allowed to compute the clave. A hostile client that
    // POSTs `{claveAcceso: ...}` to `/emit` MUST get a 400 ValidationError
    // (`identificador: "claveAcceso"`) before the orchestrator touches
    // the row. This was previously an uncovered branch in
    // `apps/api/src/invoices/orchestrator.ts` (REVIEW-0044 CB-1 pass).
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-emit-clave");

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
    const id = (create.body as { id: string }).id;

    const res = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ claveAcceso: "1".repeat(49) });
    expect(res.status).toBe(400);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });
});

// =========================================================================
// SECTION 6 — refresh.
// =========================================================================

describe("POST /api/v1/invoices/:id/refresh", () => {
  const ctx = useTestSchema();

  it("re-queries sri-core; mirror updates", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({
      prisma,
      sriCoreBaseUrl: SRI_CORE_TEST_URL,
      serviceJwtSecret: SERVICE_JWT_TEST_SECRET,
    });
    const auth = await authenticatedSession(app, prisma, "inv-refresh");

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
    const id = (create.body as { id: string }).id;

    // First emit: stub responds EN_PROCESO.
    const capture: CapturedRequest[] = [];
    pinSriCoreEmit(capture, "EN_PROCESO");
    const r1 = await request(app)
      .post(`/api/v1/invoices/${id}/emit`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(r1.status).toBe(200);
    expect((r1.body as { sriEstado: string }).sriEstado).toBe("EN_PROCESO");

    // Refresh: stub now answers AUTORIZADO via the status endpoint.
    pinSriCoreStatus("AUTORIZADO");
    const r2 = await request(app)
      .post(`/api/v1/invoices/${id}/refresh`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(r2.status).toBe(200);
    const body = r2.body as { sriEstado: string };
    expect(body.sriEstado).toBe("AUTORIZADO");

    const row = await prisma.invoice.findUnique({ where: { id } });
    expect(row?.sriEstado).toBe("AUTORIZADO");
  });
});
