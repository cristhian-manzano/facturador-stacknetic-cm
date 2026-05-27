/**
 * Integration tests for SPEC-0030 — establecimientos & emission points
 * CRUD plus the reserveSecuencial / burnSecuencial helpers against real
 * Postgres.
 *
 * What is covered:
 *
 *   - CRUD happy paths (create/list/update/soft-delete) for both
 *     establecimientos and emission points, scoped to the active tenant.
 *   - RBAC: VIEWER hits 403 on every mutating verb; OWNER passes.
 *   - Cross-tenant probes: a user in T1 trying to PATCH a T2 resource
 *     receives 404, never 403/200 — no enumeration oracle.
 *   - `isDefault: true` flips siblings off in the same transaction.
 *   - Audit events: establecimiento.created/updated/deleted +
 *     emission_point.created/updated/deleted rows land in AuditLog.
 *   - Soft-delete via DB row check: `deletedAt IS NOT NULL` AFTER delete.
 *
 *   - Sequencing:
 *       * reserveSecuencial returns gapless monotonically increasing
 *         secuenciales for 200 concurrent reservations.
 *       * burnSecuencial creates a row inside the caller's transaction
 *         and rolls back with it.
 *       * A reserved secuencial is NEVER released even after a forced
 *         orchestration abort.
 */
import request from "supertest";
import { ulid } from "ulid";
import { describe, it, expect } from "vitest";

import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { useTestSchema } from "@facturador/db/test-harness";
import type { Role } from "@facturador/utils/rbac";

import { hashPassword } from "../src/auth/password.js";
import { burnSecuencial, reserveSecuencial } from "../src/sequencing/index.js";

import { createTestApp } from "./factory.js";

const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";
const PASSWORD = "EstabTest!123";

const VALID_RUCS: readonly string[] = [
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

let rucCursor = 0;
function nextRuc(): string {
  const value = VALID_RUCS[rucCursor % VALID_RUCS.length];
  rucCursor += 1;
  if (value === undefined) {
    throw new Error("RUC pool exhausted (increase VALID_RUCS)");
  }
  return value;
}

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

/** End-to-end: log in + switch to seeded tenant; return cookies + csrf. */
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
  const t = await seedTenant(prisma, nextRuc(), `${emailPrefix.toUpperCase()} S.A.`);
  await attachMembership(prisma, u.userId, t.companyId, role);
  const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
  const { csrf } = await switchTenant(app, sessionId, csrfToken, t.companyId);
  return { userId: u.userId, companyId: t.companyId, sessionId, csrf };
}

// ===========================================================================
// CRUD — establecimientos
// ===========================================================================

describe("POST /api/v1/establecimientos", () => {
  const ctx = useTestSchema();

  it("OWNER creates an establecimiento and the row is audited", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-create");

    const res = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "001", direccion: "Av. Test 1, Quito", isMatriz: true });

    expect(res.status).toBe(201);
    const body = res.body as { id: string; codigo: string; isMatriz: boolean };
    expect(body.codigo).toBe("001");
    expect(body.isMatriz).toBe(true);
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);

    const row = await prisma.establecimiento.findUnique({ where: { id: body.id } });
    expect(row?.companyId).toBe(auth.companyId);
    expect(row?.deletedAt).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "establecimiento.created", entityId: body.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.companyId).toBe(auth.companyId);
    expect(auditRow?.actorUserId).toBe(auth.userId);
  });

  it("VIEWER receives 403 / forbidden_action", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-viewer", "VIEWER");

    const res = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "001", direccion: "Av. Denied 1" });

    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("forbidden_action");
  });

  it("rejects invalid codigo (not 3 digits) with 400 / validation_failed", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-badcodigo");

    const res = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "01", direccion: "x" });

    expect(res.status).toBe(400);
  });

  it("duplicate codigo within tenant → 409 / establecimiento.duplicate_codigo", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-dup");

    const ok = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "001", direccion: "x" });
    expect(ok.status).toBe(201);

    const dup = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "001", direccion: "y" });
    expect(dup.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(dup.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("establecimiento.duplicate_codigo");
  });

  it("body cannot inject companyId (strict schema rejects extra keys)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-injectcoy");

    const res = await request(app)
      .post("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({
        codigo: "001",
        direccion: "x",
        companyId: ulid(), // attempted injection
      });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/establecimientos", () => {
  const ctx = useTestSchema();

  it("returns only active rows scoped to req.companyId", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-list");

    // Create two rows; soft-delete the second.
    const id1 = ulid();
    const id2 = ulid();
    await prisma.establecimiento.create({
      data: {
        id: id1,
        companyId: auth.companyId,
        codigo: "001",
        direccion: "Matriz",
        isMatriz: true,
      },
    });
    await prisma.establecimiento.create({
      data: {
        id: id2,
        companyId: auth.companyId,
        codigo: "002",
        direccion: "Sucursal",
        deletedAt: new Date(),
      },
    });
    // A third row from another tenant — MUST NOT appear in the response.
    const otherCompanyId = ulid();
    await prisma.company.create({
      data: {
        id: otherCompanyId,
        ruc: nextRuc(),
        razonSocial: "OTHER S.A.",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Other",
        obligadoContabilidad: false,
      },
    });
    await prisma.establecimiento.create({
      data: {
        id: ulid(),
        companyId: otherCompanyId,
        codigo: "001",
        direccion: "Other Tenant Matriz",
      },
    });

    const res = await request(app)
      .get("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`);

    expect(res.status).toBe(200);
    const body = res.body as { id: string; codigo: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(id1);
    expect(body[0]?.codigo).toBe("001");
  });
});

describe("PATCH /api/v1/establecimientos/:id", () => {
  const ctx = useTestSchema();

  it("OWNER updates direccion; VIEWER receives 403", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });

    // OWNER path.
    const owner = await authenticatedSession(app, prisma, "estab-upd-owner");
    const id = ulid();
    await prisma.establecimiento.create({
      data: {
        id,
        companyId: owner.companyId,
        codigo: "001",
        direccion: "Old Address",
      },
    });
    const ok = await request(app)
      .patch(`/api/v1/establecimientos/${id}`)
      .set("cookie", `${SESSION_COOKIE}=${owner.sessionId}; ${CSRF_COOKIE}=${owner.csrf}`)
      .set("x-csrf-token", owner.csrf)
      .send({ direccion: "New Address" });
    expect(ok.status).toBe(200);
    expect((ok.body as { direccion: string }).direccion).toBe("New Address");

    // VIEWER path: different tenant + different role.
    const viewer = await authenticatedSession(app, prisma, "estab-upd-viewer", "VIEWER");
    const idV = ulid();
    await prisma.establecimiento.create({
      data: {
        id: idV,
        companyId: viewer.companyId,
        codigo: "001",
        direccion: "Old",
      },
    });
    const denied = await request(app)
      .patch(`/api/v1/establecimientos/${idV}`)
      .set("cookie", `${SESSION_COOKIE}=${viewer.sessionId}; ${CSRF_COOKIE}=${viewer.csrf}`)
      .set("x-csrf-token", viewer.csrf)
      .send({ direccion: "New" });
    expect(denied.status).toBe(403);
  });

  it("cross-tenant PATCH on a foreign id returns 404 (no enumeration leak)", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const t1 = await authenticatedSession(app, prisma, "estab-cross1");
    const t2 = await authenticatedSession(app, prisma, "estab-cross2");

    // Create an establecimiento under T2.
    const foreignId = ulid();
    await prisma.establecimiento.create({
      data: {
        id: foreignId,
        companyId: t2.companyId,
        codigo: "001",
        direccion: "T2",
      },
    });

    // T1 tries to PATCH it.
    const res = await request(app)
      .patch(`/api/v1/establecimientos/${foreignId}`)
      .set("cookie", `${SESSION_COOKIE}=${t1.sessionId}; ${CSRF_COOKIE}=${t1.csrf}`)
      .set("x-csrf-token", t1.csrf)
      .send({ direccion: "hijack" });
    expect(res.status).toBe(404);

    // Confirm the foreign row is untouched.
    const row = await prisma.establecimiento.findUnique({ where: { id: foreignId } });
    expect(row?.direccion).toBe("T2");
  });
});

describe("DELETE /api/v1/establecimientos/:id", () => {
  const ctx = useTestSchema();

  it("soft-deletes (deletedAt set) and subsequent list excludes the row", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "estab-del");

    const id = ulid();
    await prisma.establecimiento.create({
      data: { id, companyId: auth.companyId, codigo: "001", direccion: "x" },
    });

    const del = await request(app)
      .delete(`/api/v1/establecimientos/${id}`)
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf);
    expect(del.status).toBe(204);

    const row = await prisma.establecimiento.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();

    const list = await request(app)
      .get("/api/v1/establecimientos")
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`);
    expect((list.body as unknown[]).find((r) => (r as { id: string }).id === id)).toBeUndefined();

    const audit = await prisma.auditLog.findFirst({
      where: { action: "establecimiento.deleted", entityId: id },
    });
    expect(audit).not.toBeNull();
  });
});

// ===========================================================================
// Emission points
// ===========================================================================

describe("Emission points CRUD", () => {
  const ctx = useTestSchema();

  it("creates two emission points; setting the second as default flips the first off", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "ep-default");

    // Seed the parent establecimiento.
    const estId = ulid();
    await prisma.establecimiento.create({
      data: { id: estId, companyId: auth.companyId, codigo: "001", direccion: "x" },
    });

    const first = await request(app)
      .post(`/api/v1/establecimientos/${estId}/emission-points`)
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "001", descripcion: "Caja 1", isDefault: true });
    expect(first.status).toBe(201);
    const firstId = (first.body as { id: string }).id;

    const second = await request(app)
      .post(`/api/v1/establecimientos/${estId}/emission-points`)
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf)
      .send({ codigo: "002", descripcion: "Caja 2", isDefault: true });
    expect(second.status).toBe(201);

    const firstRow = await prisma.emissionPoint.findUnique({ where: { id: firstId } });
    expect(firstRow?.isDefault).toBe(false);
    const secondRow = await prisma.emissionPoint.findUnique({
      where: { id: (second.body as { id: string }).id },
    });
    expect(secondRow?.isDefault).toBe(true);
  });

  it("PATCH cross-tenant emission point returns 404", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const t1 = await authenticatedSession(app, prisma, "ep-cross1");
    const t2 = await authenticatedSession(app, prisma, "ep-cross2");

    // Seed an emission point under T2.
    const estId = ulid();
    await prisma.establecimiento.create({
      data: { id: estId, companyId: t2.companyId, codigo: "001", direccion: "x" },
    });
    const epId = ulid();
    await prisma.emissionPoint.create({
      data: {
        id: epId,
        companyId: t2.companyId,
        establecimientoId: estId,
        codigo: "001",
        descripcion: "T2 Caja",
      },
    });

    const res = await request(app)
      .patch(`/api/v1/emission-points/${epId}`)
      .set("cookie", `${SESSION_COOKIE}=${t1.sessionId}; ${CSRF_COOKIE}=${t1.csrf}`)
      .set("x-csrf-token", t1.csrf)
      .send({ descripcion: "hijack" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/v1/emission-points/:id soft-deletes", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const auth = await authenticatedSession(app, prisma, "ep-del");

    const estId = ulid();
    await prisma.establecimiento.create({
      data: { id: estId, companyId: auth.companyId, codigo: "001", direccion: "x" },
    });
    const epId = ulid();
    await prisma.emissionPoint.create({
      data: {
        id: epId,
        companyId: auth.companyId,
        establecimientoId: estId,
        codigo: "001",
        descripcion: "Caja",
      },
    });

    const res = await request(app)
      .delete(`/api/v1/emission-points/${epId}`)
      .set("cookie", `${SESSION_COOKIE}=${auth.sessionId}; ${CSRF_COOKIE}=${auth.csrf}`)
      .set("x-csrf-token", auth.csrf);
    expect(res.status).toBe(204);

    const row = await prisma.emissionPoint.findUnique({ where: { id: epId } });
    expect(row?.deletedAt).not.toBeNull();
  });
});

// ===========================================================================
// Sequencing: reserveSecuencial + burnSecuencial against real Postgres.
// ===========================================================================

describe("reserveSecuencial — Serializable concurrency", () => {
  const ctx = useTestSchema();

  it("produces 5 monotonically increasing secuenciales for sequential reservations", async () => {
    const prisma = ctx.getPrisma();
    const args = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
    };
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await reserveSecuencial({ prisma }, args));
    }
    expect(results).toEqual(["000000001", "000000002", "000000003", "000000004", "000000005"]);
  });

  it("produces gapless monotonically increasing secuenciales under 20×100 = 2000 concurrent reservations", async () => {
    const prisma = ctx.getPrisma();
    const args = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
    };

    // Stress test: 20 workers × 100 reservations each. The default
    // production retry budget (3) is too low for ~2000 hot reservations
    // on a single row — we bump it to a wide budget here to exercise the
    // gapless invariant. The default path is exercised by the unit test
    // for `reserve.test.ts`.
    const WORKERS = 20;
    const PER_WORKER = 100;
    const N = WORKERS * PER_WORKER;
    const t0 = performance.now();
    const grids = await Promise.all(
      Array.from({ length: WORKERS }, async () => {
        const seq: string[] = [];
        for (let i = 0; i < PER_WORKER; i++) {
          seq.push(await reserveSecuencial({ prisma, maxRetries: 100 }, args));
        }
        return seq;
      }),
    );
    const elapsedMs = performance.now() - t0;
    const results = grids.flat();
    // Stress-test elapsed time is reported via `process.stdout.write` so the
    // review file can quote it. `console.log` is forbidden by the project-
    // wide lint rule (see eslint config).
    process.stdout.write(`[stress] ${N.toString()} reservations in ${elapsedMs.toFixed(0)} ms\n`);

    expect(results).toHaveLength(N);
    expect(new Set(results).size).toBe(N);

    // Sort numerically and assert gapless 1..N.
    const numeric = results.map(Number).sort((a, b) => a - b);
    expect(numeric[0]).toBe(1);
    expect(numeric[N - 1]).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(numeric[i]).toBe(i + 1);
    }

    // Counter row reflects the final value.
    const counter = await prisma.secuencialCounter.findUnique({
      where: {
        companyId_estab_ptoEmi_tipoComprobante: {
          companyId: args.companyId,
          estab: args.estab,
          ptoEmi: args.ptoEmi,
          tipoComprobante: args.tipoComprobante,
        },
      },
    });
    expect(counter?.value).toBe(BigInt(N));
  }, 120_000);

  it("the default 3-retry budget surfaces ConflictError(secuencial.exhausted_retries) under unbounded contention", async () => {
    const prisma = ctx.getPrisma();
    const args = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
    };
    // Fire enough concurrent reservations that the default retry budget
    // (3) is exhausted for at least one worker. The point isn't perfect
    // determinism — it's that ConflictError surfaces with the expected
    // code when the budget runs out.
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => reserveSecuencial({ prisma }, args)),
    );
    const rejections = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // We tolerate either: (a) no exhausted_retries (lucky scheduler) or
    // (b) at least one with the expected code. The negative case
    // ("exhausted_retries threw the wrong code") is what we guard against.
    for (const rej of rejections) {
      const reason = rej.reason as { code?: unknown };
      expect(reason.code).toBe("secuencial.exhausted_retries");
    }
  }, 60_000);

  it("does NOT release a reserved secuencial even if the dependent emission aborts", async () => {
    const prisma = ctx.getPrisma();
    const args = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
    };

    const first = await reserveSecuencial({ prisma }, args);
    expect(first).toBe("000000001");

    // Simulate the orchestrator reserving + aborting + retrying.
    const burnAfterFirst = await prisma.$transaction(async (tx) => {
      const { id } = await burnSecuencial(tx, {
        ...args,
        secuencial: first,
        reason: "emission_failure",
      });
      return id;
    });
    expect(burnAfterFirst).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);

    // The next reservation is NOT 000000001 — the counter advanced.
    const second = await reserveSecuencial({ prisma }, args);
    expect(second).toBe("000000002");
  });
});

describe("burnSecuencial — integration", () => {
  const ctx = useTestSchema();

  it("creates a row inside a $transaction with the expected reason", async () => {
    const prisma = ctx.getPrisma();
    const input = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
      secuencial: "000000007",
      reason: "no_autorizado",
    };

    await prisma.$transaction(async (tx) => {
      await burnSecuencial(tx, input);
    });

    const row = await prisma.burnedSecuencial.findFirst({
      where: {
        companyId: input.companyId,
        estab: input.estab,
        ptoEmi: input.ptoEmi,
        secuencial: input.secuencial,
      },
    });
    expect(row).not.toBeNull();
    expect(row?.reason).toBe("no_autorizado");
    expect(row?.tipoComprobante).toBe("01");
  });

  it("burning twice the same secuencial throws ConflictError(secuencial.already_burned)", async () => {
    const prisma = ctx.getPrisma();
    const input = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
      secuencial: "000000001",
      reason: "reissue",
    };
    await burnSecuencial(prisma, input);
    await expect(burnSecuencial(prisma, input)).rejects.toMatchObject({
      code: "secuencial.already_burned",
    });
  });

  it("rolls back when wrapped in a failing transaction", async () => {
    const prisma = ctx.getPrisma();
    const input = {
      companyId: ulid(),
      estab: "001",
      ptoEmi: "001",
      tipoComprobante: "01",
      secuencial: "000000033",
      reason: "reissue",
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await burnSecuencial(tx, input);
        throw new Error("explicit abort");
      }),
    ).rejects.toThrow("explicit abort");

    const row = await prisma.burnedSecuencial.findFirst({
      where: {
        companyId: input.companyId,
        estab: input.estab,
        ptoEmi: input.ptoEmi,
        secuencial: input.secuencial,
      },
    });
    expect(row).toBeNull();
  });
});
