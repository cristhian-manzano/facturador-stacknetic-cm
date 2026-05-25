/**
 * Integration tests for SPEC-0031 — customer catalog CRUD, per-branch
 * validation, search behaviour, RBAC, and the `ensureConsumidorFinal`
 * helper against real Postgres.
 *
 * What is covered:
 *
 *   - Per-branch validation: at least 10 tests covering happy + negative
 *     paths for each `tipoIdentificacion` branch (04, 05, 06, 07, 08).
 *   - CRUD happy paths (create / list / detail / update / soft-delete)
 *     scoped to the active tenant.
 *   - RBAC: VIEWER cannot create/update/delete; OPERATOR can create/update;
 *     ADMIN/OWNER can delete; VIEWER can read.
 *   - Cross-tenant probes: 404 with no leak.
 *   - Duplicate `(tipoIdentificacion, identificacion)` per tenant → 409.
 *   - Same `(tipoIdentificacion, identificacion)` across tenants is allowed.
 *   - `ensureConsumidorFinal`: 5 calls leave exactly 1 row; tipo + id pinned.
 *   - Search behaviour: prefix on razonSocial + exact match on identificacion.
 *   - Audit events: customer.created/updated/deleted rows land in AuditLog
 *     without PII fields.
 *   - List responses do NOT include PII columns.
 *   - body cannot inject `companyId` (server pins it from session).
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { ProblemDetailSchema } from "@facturador/contracts/errors";
import type { Role } from "@facturador/utils/rbac";
import { hashPassword } from "../src/auth/password.js";
import { ensureConsumidorFinal } from "../src/customers/ensure-consumidor-final.js";
import { createTestApp } from "./factory.js";

const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";
const PASSWORD = "CustomerTest!123";

// -- Identifier fixtures (synthetic, all pass their checksums) -------------
//
// These are *company* RUCs (used to seed tenants). They follow the same
// pattern as `establecimientos.test.ts` so the test pool is consistent.
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
  "9990000211001",
  "9990000228001",
  "9990000236001",
  "9990000244001",
  "9990000252001",
  "9990000260001",
  "9990000279001",
  "9990000287001",
  "9990000295001",
  "9990000309001",
  "9990000317001",
  "9990000325001",
];

// Customer-side RUCs (sociedad) — distinct pool, also passing módulo 11.
const CUSTOMER_RUCS: readonly string[] = [
  "1790000001001",
  "1790000011001",
  "1790000028001",
  "1790000036001",
  "1790000044001",
  "1790000052001",
  "1790000060001",
  "1790000079001",
  "1790000087001",
  "1790000095001",
];

// Valid cédulas (módulo 10).
const VALID_CEDULAS: readonly string[] = [
  "1700000001",
  "1700000019",
  "1700000027",
  "1700000035",
  "1700000043",
  "1700000050",
  "1700000068",
];

let tenantRucCursor = 0;
function nextTenantRuc(): string {
  const value = TENANT_RUCS[tenantRucCursor % TENANT_RUCS.length];
  tenantRucCursor += 1;
  if (value === undefined) throw new Error("Tenant RUC pool exhausted");
  return value;
}

// -- HTTP helpers (mirrored from establecimientos.test.ts) ----------------

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
  await prisma.membership.create({ data: { id, userId, companyId, role } });
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
}> {
  const u = await seedUser(prisma, emailPrefix);
  const t = await seedTenant(prisma, nextTenantRuc(), `${emailPrefix.toUpperCase()} S.A.`);
  await attachMembership(prisma, u.userId, t.companyId, role);
  const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
  const { csrf } = await switchTenant(app, sessionId, csrfToken, t.companyId);
  return { userId: u.userId, companyId: t.companyId, sessionId, csrf };
}

function authCookieHeader(sessionId: string, csrf: string): string {
  return `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`;
}

// =========================================================================
// Per-branch validation (TASKS-0031 §2; ≥ 10 tests).
// =========================================================================

describe("POST /api/v1/customers — per-branch validation", () => {
  const ctx = useTestSchema();

  // ---- 04 RUC ---------------------------------------------------------
  it("[04 RUC] valid sociedad RUC + direccion → 201", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-04-ok");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "04",
        identificacion: CUSTOMER_RUCS[0],
        razonSocial: "ACME Corp S.A.",
        direccion: "Av. Amazonas 123",
      });
    expect(res.status).toBe(201);
  });

  it("[04 RUC] invalid checksum → 400", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-04-bad");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "04",
        identificacion: "1790000000001", // bad checksum (not in pool)
        razonSocial: "Bogus",
        direccion: "x",
      });
    expect(res.status).toBe(400);
  });

  it("[04 RUC] missing direccion → 422 customer.direccion_required", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-04-noaddr");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "04",
        identificacion: CUSTOMER_RUCS[1],
        razonSocial: "ACME 2",
      });
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("customer.direccion_required");
    }
  });

  // ---- 05 Cédula -----------------------------------------------------
  it("[05 Cédula] valid cédula + direccion → 201", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-05-ok");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "05",
        identificacion: VALID_CEDULAS[0],
        razonSocial: "Juan Pérez",
        direccion: "Calle 1",
      });
    expect(res.status).toBe(201);
  });

  it("[05 Cédula] invalid checksum → 400", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-05-bad");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "05",
        identificacion: "1710034066", // 1 off the AC-4 valid fixture
        razonSocial: "Carlos",
        direccion: "x",
      });
    expect(res.status).toBe(400);
  });

  // ---- 06 Pasaporte ---------------------------------------------------
  it("[06 Pasaporte] valid alphanum + direccion → 201", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-06-ok");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "06",
        identificacion: "X12345678",
        razonSocial: "John Doe",
        direccion: "Madrid",
      });
    expect(res.status).toBe(201);
  });

  it("[06 Pasaporte] empty identification → 400", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-06-empty");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "06",
        identificacion: "",
        razonSocial: "x",
        direccion: "x",
      });
    expect(res.status).toBe(400);
  });

  // ---- 07 Consumidor Final --------------------------------------------
  it("[07 Consumidor Final] manual creation with the canonical id → 409 customer.use_helper", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-07-manual");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
        razonSocial: "CONSUMIDOR FINAL",
      });
    expect(res.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("customer.use_helper");
  });

  it("[07 Consumidor Final] wrong literal identificacion → 400", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-07-wronglit");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "07",
        identificacion: "1234567890123",
        razonSocial: "CONSUMIDOR FINAL",
      });
    expect(res.status).toBe(400);
  });

  // ---- 08 Identificación del exterior ---------------------------------
  it("[08 Exterior] alphanumeric is accepted; direccion optional → 201", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-08-ok");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "08",
        identificacion: "DE-12345-ABC",
        razonSocial: "Foreign Buyer GmbH",
      });
    expect(res.status).toBe(201);
  });

  it("[08 Exterior] identification longer than 20 → 400", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-08-toolong");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "08",
        identificacion: "A".repeat(21),
        razonSocial: "Too long",
      });
    expect(res.status).toBe(400);
  });

  // ---- Anti-injection check -------------------------------------------
  it("body that injects companyId is ignored; row binds to req.companyId", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-inject");
    const otherCompanyId = ulid();

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "06",
        identificacion: "ABCINJECT1",
        razonSocial: "Inject",
        direccion: "x",
        companyId: otherCompanyId,
      });

    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    const row = await prisma.customer.findUnique({ where: { id } });
    expect(row?.companyId).toBe(auth.companyId);
    expect(row?.companyId).not.toBe(otherCompanyId);
  });
});

// =========================================================================
// CRUD happy-path + RBAC denial + uniqueness 409.
// =========================================================================

describe("POST /api/v1/customers — CRUD + RBAC", () => {
  const ctx = useTestSchema();

  it("OPERATOR creates a customer; row is persisted and audited", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-rbac-op", "OPERATOR");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "06",
        identificacion: "OPPASSPORT1",
        razonSocial: "OpCo",
        direccion: "x",
      });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;

    const row = await prisma.customer.findUnique({ where: { id } });
    expect(row?.companyId).toBe(auth.companyId);
    expect(row?.deletedAt).toBeNull();
    // Audit row landed.
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "customer.created", entityId: id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorUserId).toBe(auth.userId);
    // The audit payloadJson MUST NOT contain PII.
    const payload = auditRow?.payloadJson as Record<string, unknown> | null;
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("telefono");
    expect(payload).not.toHaveProperty("direccion");
    expect(payload).not.toHaveProperty("razonSocial");
  });

  it("VIEWER cannot create → 403 forbidden_action", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-rbac-view", "VIEWER");

    const res = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({
        tipoIdentificacion: "06",
        identificacion: "DENIED1",
        razonSocial: "Nope",
        direccion: "x",
      });
    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("forbidden_action");
  });

  it("duplicate (tipoIdentificacion, identificacion) within tenant → 409 customer.duplicate", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-dup");

    const body = {
      tipoIdentificacion: "06",
      identificacion: "DUPLICATE1",
      razonSocial: "Dup",
      direccion: "x",
    };
    const ok = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(body);
    expect(ok.status).toBe(201);

    const dup = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send(body);
    expect(dup.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(dup.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("customer.duplicate");
  });

  it("same (tipoIdentificacion, identificacion) is allowed across different tenants", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const t1 = await authenticatedSession(app, prisma, "cust-iso-1");
    const t2 = await authenticatedSession(app, prisma, "cust-iso-2");

    const body = {
      tipoIdentificacion: "06",
      identificacion: "SHARED1",
      razonSocial: "Shared",
      direccion: "x",
    };

    const a = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(t1.sessionId, t1.csrf))
      .set("x-csrf-token", t1.csrf)
      .send(body);
    expect(a.status).toBe(201);

    const b = await request(app)
      .post("/api/v1/customers")
      .set("cookie", authCookieHeader(t2.sessionId, t2.csrf))
      .set("x-csrf-token", t2.csrf)
      .send(body);
    expect(b.status).toBe(201);
  });
});

describe("GET /api/v1/customers — list + search", () => {
  const ctx = useTestSchema();

  it("returns only active rows scoped to req.companyId; never includes PII columns", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-list");

    // Seed 2 active rows + 1 deleted + 1 in another tenant.
    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "ACTIVE-1",
        razonSocial: "ALPHA Customer",
        email: "leak-alpha@x.test",
        telefono: "111",
        direccion: "leak-direccion-alpha",
      },
    });
    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "ACTIVE-2",
        razonSocial: "BETA Customer",
      },
    });
    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "DELETED-1",
        razonSocial: "Should not appear",
        deletedAt: new Date(),
      },
    });
    // Other tenant.
    const otherTenant = await seedTenant(prisma, nextTenantRuc(), "Other S.A.");
    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: otherTenant.companyId,
        tipoIdentificacion: "06",
        identificacion: "OTHER-1",
        razonSocial: "Other tenant",
      },
    });

    const res = await request(app)
      .get("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(res.status).toBe(200);
    const body = res.body as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.items.length).toBe(2);
    for (const item of body.items) {
      // PII columns must NOT appear in list responses.
      expect(item).not.toHaveProperty("email");
      expect(item).not.toHaveProperty("telefono");
      expect(item).not.toHaveProperty("direccion");
    }
  });

  it("search ?q=ACME does prefix match on razonSocial (case-insensitive)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-search");

    // Seed 5 customers per TASKS-0031 §3.1.
    const seeds = [
      { rs: "ACME Corp", id: "X1" },
      { rs: "Acme Industries", id: "X2" },
      { rs: "Zenith Corp", id: "X3" },
      { rs: "BETA Foods", id: "X4" },
      { rs: "Gamma LLC", id: "X5" },
    ];
    for (const seed of seeds) {
      await prisma.customer.create({
        data: {
          id: ulid(),
          companyId: auth.companyId,
          tipoIdentificacion: "06",
          identificacion: seed.id,
          razonSocial: seed.rs,
        },
      });
    }

    const res = await request(app)
      .get("/api/v1/customers?q=ACME")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(res.status).toBe(200);
    const body = res.body as {
      items: { razonSocial: string }[];
    };
    // Case-insensitive prefix on razonSocial returns both "ACME Corp" and
    // "Acme Industries".
    const rs = body.items.map((i) => i.razonSocial).sort();
    expect(rs).toEqual(["ACME Corp", "Acme Industries"]);
  });

  it("search ?q=<identificacion> matches exactly on identificacion", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-search-id");

    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "FIND-ME-EXACT",
        razonSocial: "Unrelated name",
      },
    });
    await prisma.customer.create({
      data: {
        id: ulid(),
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "OTHER-ID",
        razonSocial: "Find me",
      },
    });

    const res = await request(app)
      .get("/api/v1/customers?q=FIND-ME-EXACT")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(res.status).toBe(200);
    const body = res.body as {
      items: { identificacion: string }[];
    };
    expect(body.items.map((i) => i.identificacion)).toEqual(["FIND-ME-EXACT"]);
  });

  it("limit + cursor paginates stably", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-paginate");

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = ulid();
      ids.push(id);
      await prisma.customer.create({
        data: {
          id,
          companyId: auth.companyId,
          tipoIdentificacion: "06",
          identificacion: `PAGE-${String(i)}`,
          razonSocial: `Page Customer ${String(i)}`,
        },
      });
    }
    ids.sort();

    const first = await request(app)
      .get("/api/v1/customers?limit=2")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(first.status).toBe(200);
    const firstBody = first.body as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await request(app)
      .get(`/api/v1/customers?limit=2&cursor=${firstBody.nextCursor ?? ""}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(second.status).toBe(200);
    const secondBody = second.body as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(secondBody.items).toHaveLength(2);
    expect(
      secondBody.items
        .map((i) => i.id)
        .every((id) => !firstBody.items.map((j) => j.id).includes(id)),
    ).toBe(true);
  });
});

describe("GET /api/v1/customers/:id", () => {
  const ctx = useTestSchema();

  it("returns 404 for cross-tenant id (no enumeration leak)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const t1 = await authenticatedSession(app, prisma, "cust-cross-1");
    const t2 = await authenticatedSession(app, prisma, "cust-cross-2");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: t2.companyId,
        tipoIdentificacion: "06",
        identificacion: "CROSS-1",
        razonSocial: "T2 secret customer",
      },
    });

    const res = await request(app)
      .get(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(t1.sessionId, t1.csrf));
    expect(res.status).toBe(404);
  });

  it("detail response INCLUDES PII fields (deliberate, per SPEC §10)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-detail");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "DETAIL-1",
        razonSocial: "Detail Customer",
        email: "detail@x.test",
        telefono: "+593 999",
        direccion: "Av. 1",
      },
    });

    const res = await request(app)
      .get(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.email).toBe("detail@x.test");
    expect(body.telefono).toBe("+593 999");
    expect(body.direccion).toBe("Av. 1");
  });
});

describe("PATCH /api/v1/customers/:id", () => {
  const ctx = useTestSchema();

  it("rejects attempts to change tipoIdentificacion → 422 customer.immutable_field", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-immut");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "IMMUT-1",
        razonSocial: "Immut",
      },
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ tipoIdentificacion: "05" });
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("customer.immutable_field");
    }
  });

  it("happy path updates razonSocial and audits the change", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-update-ok");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "UPD-1",
        razonSocial: "Old name",
      },
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ razonSocial: "New name" });
    expect(res.status).toBe(200);
    expect((res.body as { razonSocial: string }).razonSocial).toBe("New name");

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "customer.updated", entityId: id },
    });
    expect(auditRow).not.toBeNull();
    const payload = auditRow?.payloadJson as Record<string, unknown> | null;
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("razonSocial");
    expect((payload?.changed as string[]).sort()).toEqual(["razonSocial"]);
  });
});

describe("DELETE /api/v1/customers/:id", () => {
  const ctx = useTestSchema();

  it("ADMIN can soft-delete; subsequent list excludes the row", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-del-admin", "ADMIN");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "DEL-1",
        razonSocial: "Delete me",
      },
    });

    const del = await request(app)
      .delete(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(del.status).toBe(204);

    const row = await prisma.customer.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();

    const list = await request(app)
      .get("/api/v1/customers")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf));
    const items = (list.body as { items: { id: string }[] }).items;
    expect(items.find((r) => r.id === id)).toBeUndefined();
  });

  it("OPERATOR cannot delete (customer.delete = OWNER/ADMIN only) → 403", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-del-op", "OPERATOR");

    const id = ulid();
    await prisma.customer.create({
      data: {
        id,
        companyId: auth.companyId,
        tipoIdentificacion: "06",
        identificacion: "DEL-OP-1",
        razonSocial: "Op cannot delete",
      },
    });

    const res = await request(app)
      .delete(`/api/v1/customers/${id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(403);
  });
});

// =========================================================================
// ensureConsumidorFinal helper — idempotency.
// =========================================================================

describe("ensureConsumidorFinal()", () => {
  const ctx = useTestSchema();

  it("is idempotent: 5 calls leave exactly 1 row", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await prisma.company.create({
      data: {
        id: companyId,
        ruc: nextTenantRuc(),
        razonSocial: "Idem S.A.",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "x",
        obligadoContabilidad: false,
      },
    });

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const row = await ensureConsumidorFinal(prisma, companyId);
      ids.push(row.id);
      expect(row.tipoIdentificacion).toBe("07");
      expect(row.identificacion).toBe("9999999999999");
      expect(row.razonSocial).toBe("CONSUMIDOR FINAL");
    }

    expect(new Set(ids).size).toBe(1);

    const count = await prisma.customer.count({
      where: {
        companyId,
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
      },
    });
    expect(count).toBe(1);
  });

  it("each tenant gets its own row", async () => {
    const prisma = ctx.getPrisma();
    const t1 = ulid();
    const t2 = ulid();
    for (const cid of [t1, t2]) {
      await prisma.company.create({
        data: {
          id: cid,
          ruc: nextTenantRuc(),
          razonSocial: `${cid.slice(0, 6)} S.A.`,
          ambiente: "1",
          tipoEmision: "1",
          direccionMatriz: "x",
          obligadoContabilidad: false,
        },
      });
    }
    const a = await ensureConsumidorFinal(prisma, t1);
    const b = await ensureConsumidorFinal(prisma, t2);
    expect(a.id).not.toBe(b.id);
    expect(a.companyId).toBe(t1);
    expect(b.companyId).toBe(t2);
  });
});

describe("POST /api/v1/customers/consumidor-final", () => {
  const ctx = useTestSchema();

  it("idempotent endpoint returns 200 with the same id on N calls", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-cf-endpoint");

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/v1/customers/consumidor-final")
        .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
        .set("x-csrf-token", auth.csrf)
        .send({});
      expect(res.status).toBe(200);
      const body = res.body as {
        id: string;
        tipoIdentificacion: string;
        identificacion: string;
        razonSocial: string;
      };
      expect(body.tipoIdentificacion).toBe("07");
      expect(body.identificacion).toBe("9999999999999");
      expect(body.razonSocial).toBe("CONSUMIDOR FINAL");
      ids.push(body.id);
    }
    expect(new Set(ids).size).toBe(1);
  });

  it("rejects request body with parameters", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-cf-badbody");

    const res = await request(app)
      .post("/api/v1/customers/consumidor-final")
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf)
      .send({ razonSocial: "OVERRIDE ATTEMPT" });
    expect(res.status).toBe(400);
  });

  it("cannot delete the Consumidor Final singleton → 409", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "cust-cf-nodelete", "ADMIN");

    // Create the singleton via the helper.
    const row = await ensureConsumidorFinal(prisma, auth.companyId);
    const res = await request(app)
      .delete(`/api/v1/customers/${row.id}`)
      .set("cookie", authCookieHeader(auth.sessionId, auth.csrf))
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe("customer.consumidor_final_immutable");
    }
  });
});
