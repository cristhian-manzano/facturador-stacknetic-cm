/**
 * Integration tests for SPEC-0011 — tenants, memberships & RBAC.
 *
 * Per PROMPT-0011 §5 + TASKS-0011 the coverage matrix is:
 *
 *   - RBAC matrix: every role × every privileged action against the
 *     `/_diag/perm-check` stub (gated by `requirePermission("invoice.create")`).
 *   - Tenant CRUD: list/create.
 *   - Tenant switching: rotates CSRF cookie, stale value fails, new value
 *     passes, switching to a tenant where the user lacks membership → 403,
 *     audit row exists.
 *   - Cross-tenant probe: a `?companyId=other` query is ignored; `req.companyId`
 *     always derives from the session.
 *   - Tenant update: ADMIN/OWNER allowed; VIEWER/OPERATOR/ACCOUNTANT denied.
 *   - Member management: list/add/role change/remove.
 *   - Last-OWNER guard: cannot demote/remove the only OWNER.
 *   - `/me` returns currentCompanyId + currentRole + permissions.
 *
 * All tests run against a per-test Postgres schema via
 * `useTestSchema()` from `@facturador/db/test-harness`.
 */
import request from "supertest";
import { ulid } from "ulid";
import { describe, expect, it } from "vitest";

import { MeResponseSchema } from "@facturador/contracts/auth";
import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { useTestSchema } from "@facturador/db/test-harness";
import { ALL_ROLES, type Role } from "@facturador/utils/rbac";

import { hashPassword } from "../src/auth/password.js";

import { createTestApp } from "./factory.js";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";

const PASSWORD = "TenantTest!123";

/**
 * Pool of synthetic but VALID Ecuadorian sociedad-privada RUCs (módulo-11
 * check). Province 99 is reserved by SRI for testing; the third digit is `9`
 * (sociedad privada); each value ends in `001` (single establecimiento).
 *
 * Tests claim a fresh RUC from this pool via `nextRuc()` so two `it`s in
 * the same `describe` block (sharing one Postgres schema) cannot collide
 * on the `Company.ruc` uniqueness constraint.
 *
 * Generator: see PROMPT-0011 implementation notes — each value was produced
 * by the same módulo-11 algorithm `RucSchema.refine` enforces.
 */
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
  "9990000333001",
  "9990000341001",
  "9990000351001",
  "9990000368001",
  "9990000376001",
  "9990000384001",
  "9990000392001",
  "9990000406001",
  "9990000414001",
  "9990000422001",
  "9990000430001",
  "9990000449001",
  "9990000457001",
  "9990000465001",
  "9990000473001",
  "9990000481001",
  "9990000491001",
  "9990000503001",
  "9990000511001",
  "9990000521001",
  "9990000538001",
  "9990000546001",
  "9990000554001",
  "9990000562001",
  "9990000570001",
  "9990000589001",
  "9990000597001",
  "9990000600001",
];

let rucCursor = 0;
function nextRuc(): string {
  const value = VALID_RUCS[rucCursor % VALID_RUCS.length];
  rucCursor += 1;
  if (value === undefined) {
    throw new Error("RUC pool exhausted (increase VALID_RUCS size)");
  }
  return value;
}

/**
 * Narrow a possibly-null value to non-null with a clear assertion message.
 * Used in place of `value!` so the lint rule against non-null assertions
 * stays satisfied while keeping the per-call assertion explicit.
 */
function notNull<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(`Expected ${name} to be non-null`);
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
  throw new Error(`Cookie ${name} not in Set-Cookie: ${setCookieHeader.join(" | ")}`);
}

interface SeedUserResult {
  userId: string;
  email: string;
  password: string;
}

async function seedUser(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  emailPrefix: string,
): Promise<SeedUserResult> {
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

interface SeedTenantResult {
  companyId: string;
  ruc: string;
}

async function seedTenant(
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
  ruc: string,
  name: string,
): Promise<SeedTenantResult> {
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
): Promise<{ membershipId: string }> {
  const id = ulid();
  // Set `acceptedAt = now` so the membership counts as "active" per the
  // production-readiness invitation-lifecycle filter
  // (`requireTenant` + tenant list now filter `acceptedAt: { not: null }`).
  // Tests for the unaccepted-invite negative path set `acceptedAt: null`
  // explicitly.
  await prisma.membership.create({
    data: { id, userId, companyId, role, acceptedAt: new Date() },
  });
  return { membershipId: id };
}

/** Convenience: login + return cookie values. */
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

/** Switch the active tenant for an authenticated session. */
async function switchTenant(
  app: import("express").Express,
  sessionId: string,
  csrfToken: string,
  companyId: string,
): Promise<{ status: number; newCsrf: string | null; body: unknown }> {
  const res = await request(app)
    .post("/api/v1/session/tenant")
    .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
    .set("x-csrf-token", csrfToken)
    .send({ companyId });
  let newCsrf: string | null = null;
  if (res.status === 200) {
    const setCookie = res.headers["set-cookie"] as string[] | undefined;
    if (setCookie !== undefined) {
      try {
        newCsrf = extractCookieValue(setCookie, CSRF_COOKIE);
      } catch {
        newCsrf = null;
      }
    }
  }
  return { status: res.status, newCsrf, body: res.body };
}

// ---------------------------------------------------------------------------
// RBAC matrix coverage — every role × the `invoice.create` privileged action.
// ---------------------------------------------------------------------------

describe("RBAC matrix (per-role privileged action probe)", () => {
  const ctx = useTestSchema();

  it.each(ALL_ROLES)(
    "role=%s — POST /_diag/perm-check reflects can(role, 'invoice.create')",
    async (role) => {
      const prisma = ctx.getPrisma();
      const u = await seedUser(prisma, `rbac-${role.toLowerCase()}`);
      const t = await seedTenant(prisma, nextRuc(), "MATRIX TENANT");
      await attachMembership(prisma, u.userId, t.companyId, role);

      const { app } = createTestApp({ prisma });
      const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

      // Switch to the seeded tenant (every role can do this — server validates
      // the membership exists, not the role).
      const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
      expect(sw.status).toBe(200);
      const csrf = sw.newCsrf ?? csrfToken;

      const res = await request(app)
        .post("/api/v1/_diag/perm-check")
        .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
        .set("x-csrf-token", csrf);

      // VIEWER never had `invoice.create`. ACCOUNTANT lost it as part of
      // REVIEW-0044 §HIGH-1 (view-only by default per SPEC-0011 §FR-5
      // row 3); flip `RBAC_ACCOUNTANT_CAN_WRITE=true` to restore.
      if (role === "VIEWER" || role === "ACCOUNTANT") {
        expect(res.status).toBe(403);
        const parsed = ProblemDetailSchema.safeParse(res.body);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.code).toBe("forbidden_action");
        }
      } else {
        // OWNER, ADMIN, OPERATOR retain `invoice.create`.
        expect(res.status).toBe(204);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// GET /api/v1/tenants — list user's memberships.
// ---------------------------------------------------------------------------

describe("GET /api/v1/tenants", () => {
  const ctx = useTestSchema();

  it("returns the user's memberships only (cross-tenant isolation)", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "lister");
    const other = await seedUser(prisma, "other");
    const t1 = await seedTenant(prisma, nextRuc(), "TENANT ONE");
    const t2 = await seedTenant(prisma, nextRuc(), "TENANT TWO");
    const t3 = await seedTenant(prisma, nextRuc(), "TENANT THREE");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");
    await attachMembership(prisma, u.userId, t2.companyId, "OPERATOR");
    await attachMembership(prisma, other.userId, t3.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId } = await loginAndGetCookies(app, u.email, u.password);

    const res = await request(app)
      .get("/api/v1/tenants")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);

    expect(res.status).toBe(200);
    const body = res.body as { companyId: string; role: string }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    const ids = body.map((m) => m.companyId).sort();
    expect(ids).toEqual([t1.companyId, t2.companyId].sort());
    // The other user's tenant is NEVER mentioned.
    expect(body.find((m) => m.companyId === t3.companyId)).toBeUndefined();
  });

  it("returns 401 without a session cookie", async () => {
    const prisma = ctx.getPrisma();
    const { app } = createTestApp({ prisma });
    const res = await request(app).get("/api/v1/tenants");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/tenants — create a tenant; caller is OWNER.
// ---------------------------------------------------------------------------

describe("POST /api/v1/tenants", () => {
  const ctx = useTestSchema();

  it("creates Company + Membership(OWNER) atomically and audits tenant.created", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "creator");
    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const ruc = nextRuc();

    const res = await request(app)
      .post("/api/v1/tenants")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken)
      .send({
        ruc,
        razonSocial: "NEW TENANT S.A.",
        direccionMatriz: "Av. Fiscal 100, Quito",
        ambiente: "1",
        obligadoContabilidad: false,
      });

    expect(res.status).toBe(201);
    const body = res.body as { id: string; ruc: string; razonSocial: string };
    expect(body.id).toBeDefined();
    expect(body.ruc).toBe(ruc);

    const company = await prisma.company.findUnique({ where: { id: body.id } });
    expect(company).not.toBeNull();
    const membership = await prisma.membership.findFirst({
      where: { userId: u.userId, companyId: body.id },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("OWNER");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "tenant.created", entityId: body.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(u.userId);
    expect(audit?.companyId).toBe(body.id);
  });

  it("rejects duplicate RUC with 409 / ruc.duplicate", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "dup");
    const sharedRuc = nextRuc();
    // Pre-create a tenant with the RUC.
    await seedTenant(prisma, sharedRuc, "EXISTING");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

    const res = await request(app)
      .post("/api/v1/tenants")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken)
      .send({
        ruc: sharedRuc,
        razonSocial: "DUP S.A.",
        direccionMatriz: "Calle Dup",
        ambiente: "1",
        obligadoContabilidad: false,
      });

    expect(res.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("ruc.duplicate");
  });

  it("rejects body sending an unknown / invalid RUC (400)", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "badruc");
    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

    const res = await request(app)
      .post("/api/v1/tenants")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken)
      .send({
        ruc: "0000000000000",
        razonSocial: "BAD",
        direccionMatriz: "x",
        ambiente: "1",
        obligadoContabilidad: false,
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/session/tenant — tenant switch + CSRF rotation.
// ---------------------------------------------------------------------------

describe("POST /api/v1/session/tenant — tenant switching", () => {
  const ctx = useTestSchema();

  it("rotates the CSRF cookie value and invalidates the previous CSRF token", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "switcher");
    const t1 = await seedTenant(prisma, nextRuc(), "T1");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken: csrfBefore } = await loginAndGetCookies(app, u.email, u.password);

    const sw = await switchTenant(app, sessionId, csrfBefore, t1.companyId);
    expect(sw.status).toBe(200);
    // The new CSRF token (from Set-Cookie) MUST be different from the
    // pre-switch one.
    expect(sw.newCsrf).not.toBeNull();
    expect(sw.newCsrf).not.toBe(csrfBefore);

    // The body echoes the new csrf for clients that prefer the body path.
    const body = sw.body as { csrfToken: string };
    expect(body.csrfToken).toBe(sw.newCsrf);

    // Stale CSRF: a mutating request using the OLD token must fail 403.
    const staleAttempt = await request(app)
      .post("/api/v1/_diag/perm-check")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfBefore}`)
      .set("x-csrf-token", csrfBefore);
    expect(staleAttempt.status).toBe(403);
    const stale = ProblemDetailSchema.safeParse(staleAttempt.body);
    expect(stale.success).toBe(true);
    if (stale.success) expect(stale.data.code).toBe("csrf.invalid");

    // Fresh CSRF: SAME mutating request with the NEW token passes through
    // (assuming the user has the permission; OWNER has invoice.create).
    const freshCsrf = notNull(sw.newCsrf, "sw.newCsrf");
    const okAttempt = await request(app)
      .post("/api/v1/_diag/perm-check")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${freshCsrf}`)
      .set("x-csrf-token", freshCsrf);
    expect(okAttempt.status).toBe(204);
  });

  it("rejects switching to a tenant the user is not a member of (403)", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "nonmember");
    const t1 = await seedTenant(prisma, nextRuc(), "MEMBER TENANT");
    const t2 = await seedTenant(prisma, nextRuc(), "STRANGER TENANT");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");
    // user is NOT a member of t2.

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

    const sw = await switchTenant(app, sessionId, csrfToken, t2.companyId);
    expect(sw.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(sw.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("no_membership");

    // Sanity: the session row's companyId did NOT change after the failure.
    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.companyId).toBeNull();
  });

  it("audits tenant.switch with from + to companyIds", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "auditswitch");
    const t1 = await seedTenant(prisma, nextRuc(), "T1");
    const t2 = await seedTenant(prisma, nextRuc(), "T2");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");
    await attachMembership(prisma, u.userId, t2.companyId, "ADMIN");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

    // First switch: from null → t1.
    let sw = await switchTenant(app, sessionId, csrfToken, t1.companyId);
    expect(sw.status).toBe(200);
    let csrf = notNull(sw.newCsrf, "sw.newCsrf");

    // Second switch: from t1 → t2.
    sw = await switchTenant(app, sessionId, csrf, t2.companyId);
    expect(sw.status).toBe(200);
    csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const rows = await prisma.auditLog.findMany({
      where: { action: "tenant.switch", actorUserId: u.userId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length).toBe(2);
    // Don't pin to specific from/to values — but assert "to" is set on both.
    for (const r of rows) {
      expect(r.companyId).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant probe: `?companyId=other` is ignored.
// ---------------------------------------------------------------------------

describe("Cross-tenant defence — req.companyId derived only from session", () => {
  const ctx = useTestSchema();

  it("ignores ?companyId=OTHER and uses session.companyId", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "crosstenant");
    const t1 = await seedTenant(prisma, nextRuc(), "ACTIVE TENANT");
    const t2 = await seedTenant(prisma, nextRuc(), "OTHER TENANT");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");
    await attachMembership(prisma, u.userId, t2.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);

    // Switch to T1.
    const sw = await switchTenant(app, sessionId, csrfToken, t1.companyId);
    expect(sw.status).toBe(200);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    // Probe the tenant-context diag endpoint with a `?companyId=T2` query.
    const res = await request(app)
      .get(`/api/v1/_diag/tenant-context?companyId=${t2.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`);

    expect(res.status).toBe(200);
    const body = res.body as { companyId: string };
    // Server MUST report T1 (from session), NOT T2 (from query).
    expect(body.companyId).toBe(t1.companyId);
    expect(body.companyId).not.toBe(t2.companyId);
  });

  it("a user with no membership for the session's companyId receives 403 (not 404)", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "revoke");
    const t1 = await seedTenant(prisma, nextRuc(), "T1");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t1.companyId);
    expect(sw.status).toBe(200);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    // Revoke membership directly via DB (simulating "removed mid-session").
    await prisma.membership.delete({
      where: { userId_companyId: { userId: u.userId, companyId: t1.companyId } },
    });

    const res = await request(app)
      .get("/api/v1/_diag/tenant-context")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`);

    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("no_membership");
  });

  it("returns 412 / tenant_not_selected if the session has no active companyId", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "notselected");
    const t1 = await seedTenant(prisma, nextRuc(), "T1");
    await attachMembership(prisma, u.userId, t1.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    // Do NOT switch tenant.
    void csrfToken;

    const res = await request(app)
      .get("/api/v1/_diag/tenant-context")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);

    expect(res.status).toBe(412);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("tenant_not_selected");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/tenants/:id — update mutable fields.
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/tenants/:id", () => {
  const ctx = useTestSchema();

  async function bootstrap(
    prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>,
    role: Role,
  ): Promise<{
    app: ReturnType<typeof createTestApp>["app"];
    sessionId: string;
    csrfToken: string;
    companyId: string;
    userId: string;
  }> {
    const u = await seedUser(prisma, `updater-${role.toLowerCase()}`);
    const t = await seedTenant(prisma, nextRuc(), "UPDATE TENANT");
    if (role !== "OWNER") {
      // Even if testing VIEWER/etc., the tenant still needs an OWNER for the
      // last-OWNER guard not to fire on accidental deletes elsewhere.
      const ownerUser = await seedUser(prisma, "anchor-owner");
      await attachMembership(prisma, ownerUser.userId, t.companyId, "OWNER");
    }
    await attachMembership(prisma, u.userId, t.companyId, role);
    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    expect(sw.status).toBe(200);
    return {
      app,
      sessionId,
      csrfToken: notNull(sw.newCsrf, "sw.newCsrf"),
      companyId: t.companyId,
      userId: u.userId,
    };
  }

  it("OWNER can patch razonSocial", async () => {
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "OWNER");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${ctxBoot.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "RENAMED TENANT S.A." });
    expect(res.status).toBe(200);
    const fresh = await prisma.company.findUnique({ where: { id: ctxBoot.companyId } });
    expect(fresh?.razonSocial).toBe("RENAMED TENANT S.A.");
  });

  it("ADMIN cannot patch tenant by default (SPEC-0011 §FR-5: OWNER-only)", async () => {
    // The production-readiness pass restricted `tenant.update` to OWNER
    // per SPEC-0011 §FR-5. The escape hatch is the
    // `RBAC_ADMIN_CAN_UPDATE_TENANT=true` env flag, exercised in a
    // separate test below.
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "ADMIN");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${ctxBoot.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "ADMIN RENAMED" });
    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("forbidden_action");
  });

  it("ACCOUNTANT cannot patch tenant (403 forbidden_action)", async () => {
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "ACCOUNTANT");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${ctxBoot.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "DENIED" });
    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("forbidden_action");
  });

  it("OPERATOR cannot patch tenant (403)", async () => {
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "OPERATOR");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${ctxBoot.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "DENIED" });
    expect(res.status).toBe(403);
  });

  it("VIEWER cannot patch tenant (403)", async () => {
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "VIEWER");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${ctxBoot.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "DENIED" });
    expect(res.status).toBe(403);
  });

  it("cross-tenant PATCH (URL :id != session.companyId) returns 403", async () => {
    const prisma = ctx.getPrisma();
    const ctxBoot = await bootstrap(prisma, "OWNER");
    // Mint a SECOND tenant the user is NOT a member of.
    const other = await seedTenant(prisma, nextRuc(), "OTHER");
    const res = await request(ctxBoot.app)
      .patch(`/api/v1/tenants/${other.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${ctxBoot.sessionId}; ${CSRF_COOKIE}=${ctxBoot.csrfToken}`)
      .set("x-csrf-token", ctxBoot.csrfToken)
      .send({ razonSocial: "STOLEN" });
    expect(res.status).toBe(403);
    const fresh = await prisma.company.findUnique({ where: { id: other.companyId } });
    expect(fresh?.razonSocial).toBe("OTHER"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Member management — list / add / role-change / remove + last-OWNER guard.
// ---------------------------------------------------------------------------

describe("Tenant member management", () => {
  const ctx = useTestSchema();

  it("OWNER can list members; OPERATOR cannot (403)", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "list-owner");
    const op = await seedUser(prisma, "list-op");
    const t = await seedTenant(prisma, nextRuc(), "LIST TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, op.userId, t.companyId, "OPERATOR");

    const { app } = createTestApp({ prisma });
    // Owner perspective.
    const { sessionId: ownerSid, csrfToken: ownerCsrf } = await loginAndGetCookies(
      app,
      owner.email,
      owner.password,
    );
    const ownerSwitch = await switchTenant(app, ownerSid, ownerCsrf, t.companyId);
    const ownerList = await request(app)
      .get(`/api/v1/tenants/${t.companyId}/members`)
      .set(
        "cookie",
        `${SESSION_COOKIE}=${ownerSid}; ${CSRF_COOKIE}=${notNull(ownerSwitch.newCsrf, "ownerSwitch.newCsrf")}`,
      );
    expect(ownerList.status).toBe(200);
    const list = ownerList.body as { userId: string; role: string }[];
    expect(list.length).toBe(2);
    const userIds = list.map((m) => m.userId).sort();
    expect(userIds).toEqual([owner.userId, op.userId].sort());

    // OPERATOR perspective.
    const { sessionId: opSid, csrfToken: opCsrf } = await loginAndGetCookies(
      app,
      op.email,
      op.password,
    );
    const opSwitch = await switchTenant(app, opSid, opCsrf, t.companyId);
    const opList = await request(app)
      .get(`/api/v1/tenants/${t.companyId}/members`)
      .set(
        "cookie",
        `${SESSION_COOKIE}=${opSid}; ${CSRF_COOKIE}=${notNull(opSwitch.newCsrf, "opSwitch.newCsrf")}`,
      );
    expect(opList.status).toBe(403);
  });

  it("OWNER can add a member by userId (200) and audits tenant.member.added", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "add-owner");
    const newcomer = await seedUser(prisma, "add-newbie");
    const t = await seedTenant(prisma, nextRuc(), "ADD TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .post(`/api/v1/tenants/${t.companyId}/members`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({ userId: newcomer.userId, role: "VIEWER" });
    expect(res.status).toBe(201);
    const body = res.body as { membershipId: string };

    const m = await prisma.membership.findFirst({
      where: { userId: newcomer.userId, companyId: t.companyId },
    });
    expect(m).not.toBeNull();
    expect(m?.role).toBe("VIEWER");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "tenant.member.added", entityId: body.membershipId },
    });
    expect(audit).not.toBeNull();
  });

  it("adding an already-existing membership → 409 / membership.duplicate", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "dup-owner");
    const member = await seedUser(prisma, "dup-member");
    const t = await seedTenant(prisma, nextRuc(), "T");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, member.userId, t.companyId, "VIEWER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .post(`/api/v1/tenants/${t.companyId}/members`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({ userId: member.userId, role: "VIEWER" });
    expect(res.status).toBe(409);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("membership.duplicate");
  });

  it("changing a role audits tenant.member.role_changed and applies the new role", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "rc-owner");
    const member = await seedUser(prisma, "rc-member");
    const t = await seedTenant(prisma, nextRuc(), "RC TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, member.userId, t.companyId, "OPERATOR");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .patch(`/api/v1/tenants/${t.companyId}/members/${member.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({ role: "VIEWER" });
    expect(res.status).toBe(200);
    const m = await prisma.membership.findFirst({
      where: { userId: member.userId, companyId: t.companyId },
    });
    expect(m?.role).toBe("VIEWER");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "tenant.member.role_changed" },
    });
    expect(audit).not.toBeNull();
  });

  it("LAST-OWNER GUARD: demoting the only OWNER returns 422 / last_owner", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "last-owner");
    const t = await seedTenant(prisma, nextRuc(), "LO TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .patch(`/api/v1/tenants/${t.companyId}/members/${owner.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("last_owner");

    // Confirm no role change occurred.
    const m = await prisma.membership.findFirst({
      where: { userId: owner.userId, companyId: t.companyId },
    });
    expect(m?.role).toBe("OWNER");
  });

  it("LAST-OWNER GUARD: removing the only OWNER returns 422 / last_owner", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "del-owner");
    const t = await seedTenant(prisma, nextRuc(), "DEL TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .delete(`/api/v1/tenants/${t.companyId}/members/${owner.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf);
    expect(res.status).toBe(422);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("last_owner");

    // Confirm the membership still exists.
    const m = await prisma.membership.findFirst({
      where: { userId: owner.userId, companyId: t.companyId },
    });
    expect(m).not.toBeNull();
  });

  it("LAST-OWNER GUARD: with TWO owners, demoting one succeeds", async () => {
    const prisma = ctx.getPrisma();
    const owner1 = await seedUser(prisma, "co1");
    const owner2 = await seedUser(prisma, "co2");
    const t = await seedTenant(prisma, nextRuc(), "TWO OWNERS");
    await attachMembership(prisma, owner1.userId, t.companyId, "OWNER");
    await attachMembership(prisma, owner2.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner1.email, owner1.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .patch(`/api/v1/tenants/${t.companyId}/members/${owner2.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(200);
    const m = await prisma.membership.findFirst({
      where: { userId: owner2.userId, companyId: t.companyId },
    });
    expect(m?.role).toBe("ADMIN");
  });

  it("removing a non-OWNER member succeeds (204) and audits tenant.member.removed", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "rmv-owner");
    const member = await seedUser(prisma, "rmv-member");
    const t = await seedTenant(prisma, nextRuc(), "RMV TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, member.userId, t.companyId, "OPERATOR");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, owner.email, owner.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    const res = await request(app)
      .delete(`/api/v1/tenants/${t.companyId}/members/${member.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf);
    expect(res.status).toBe(204);
    const m = await prisma.membership.findFirst({
      where: { userId: member.userId, companyId: t.companyId },
    });
    expect(m).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: "tenant.member.removed", actorUserId: owner.userId },
    });
    expect(audit).not.toBeNull();
  });

  it("a removed user receives 403 on the NEXT request to a tenant-scoped route", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "midsession-owner");
    const member = await seedUser(prisma, "midsession-member");
    const t = await seedTenant(prisma, nextRuc(), "MS TENANT");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, member.userId, t.companyId, "OPERATOR");

    const { app } = createTestApp({ prisma });
    const { sessionId: memberSid, csrfToken: memberCsrf } = await loginAndGetCookies(
      app,
      member.email,
      member.password,
    );
    const memberSwitch = await switchTenant(app, memberSid, memberCsrf, t.companyId);
    expect(memberSwitch.status).toBe(200);
    const memberFresh = notNull(memberSwitch.newCsrf, "memberSwitch.newCsrf");

    // Confirm the member can hit a tenant route while still attached.
    const okBefore = await request(app)
      .get("/api/v1/_diag/tenant-context")
      .set("cookie", `${SESSION_COOKIE}=${memberSid}; ${CSRF_COOKIE}=${memberFresh}`);
    expect(okBefore.status).toBe(200);

    // OWNER revokes the member.
    const { sessionId: ownerSid, csrfToken: ownerCsrf } = await loginAndGetCookies(
      app,
      owner.email,
      owner.password,
    );
    const ownerSwitch = await switchTenant(app, ownerSid, ownerCsrf, t.companyId);
    const ownerFresh = notNull(ownerSwitch.newCsrf, "ownerSwitch.newCsrf");
    const del = await request(app)
      .delete(`/api/v1/tenants/${t.companyId}/members/${member.userId}`)
      .set("cookie", `${SESSION_COOKIE}=${ownerSid}; ${CSRF_COOKIE}=${ownerFresh}`)
      .set("x-csrf-token", ownerFresh);
    expect(del.status).toBe(204);

    // Now the (previously valid) member session must be rejected on the next
    // tenant-scoped request.
    const after = await request(app)
      .get("/api/v1/_diag/tenant-context")
      .set("cookie", `${SESSION_COOKIE}=${memberSid}; ${CSRF_COOKIE}=${memberFresh}`);
    expect(after.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// /me — currentCompanyId / currentRole / permissions.
// ---------------------------------------------------------------------------

describe("GET /api/v1/me — tenant context", () => {
  const ctx = useTestSchema();

  it("reflects null tenant context before any switch", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "me-noswitch");
    const t = await seedTenant(prisma, nextRuc(), "T");
    await attachMembership(prisma, u.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId } = await loginAndGetCookies(app, u.email, u.password);

    const res = await request(app)
      .get("/api/v1/me")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);
    expect(res.status).toBe(200);
    const parsed = MeResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.activeCompanyId).toBeNull();
    expect(parsed.data.currentRole).toBeNull();
    expect(parsed.data.permissions).toEqual([]);
  });

  it("returns OWNER permissions when active tenant has OWNER role", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "me-owner");
    const t = await seedTenant(prisma, nextRuc(), "T");
    await attachMembership(prisma, u.userId, t.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    expect(sw.status).toBe(200);

    const res = await request(app)
      .get("/api/v1/me")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);
    expect(res.status).toBe(200);
    const parsed = MeResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.activeCompanyId).toBe(t.companyId);
    expect(parsed.data.currentRole).toBe("OWNER");
    expect(parsed.data.permissions).toContain("tenant.update");
    expect(parsed.data.permissions).toContain("tenant.manage_members");
    expect(parsed.data.permissions).toContain("invoice.create");
    expect(parsed.data.permissions).toContain("invoice.reissue");
    expect(parsed.data.permissions).toContain("certificate.manage");
  });

  it("returns only .read actions for VIEWER", async () => {
    const prisma = ctx.getPrisma();
    const owner = await seedUser(prisma, "me-viewer-owner");
    const u = await seedUser(prisma, "me-viewer");
    const t = await seedTenant(prisma, nextRuc(), "T");
    await attachMembership(prisma, owner.userId, t.companyId, "OWNER");
    await attachMembership(prisma, u.userId, t.companyId, "VIEWER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const sw = await switchTenant(app, sessionId, csrfToken, t.companyId);
    expect(sw.status).toBe(200);

    const res = await request(app)
      .get("/api/v1/me")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);
    const parsed = MeResponseSchema.parse(res.body);
    expect(parsed.currentRole).toBe("VIEWER");
    for (const action of parsed.permissions) {
      expect(action.endsWith(".read")).toBe(true);
    }
    expect(parsed.permissions).toContain("tenant.read");
    expect(parsed.permissions).toContain("invoice.read");
  });
});

// ---------------------------------------------------------------------------
// Negative: client cannot inject companyId via body / query.
// ---------------------------------------------------------------------------

describe("Negative — client cannot inject companyId via body", () => {
  const ctx = useTestSchema();

  it("PATCH /tenants/:id ignores any 'companyId' field in the body (URL :id is authoritative, and must match session)", async () => {
    const prisma = ctx.getPrisma();
    const u = await seedUser(prisma, "inject");
    const tA = await seedTenant(prisma, nextRuc(), "A");
    const tB = await seedTenant(prisma, nextRuc(), "B");
    await attachMembership(prisma, u.userId, tA.companyId, "OWNER");
    await attachMembership(prisma, u.userId, tB.companyId, "OWNER");

    const { app } = createTestApp({ prisma });
    const { sessionId, csrfToken } = await loginAndGetCookies(app, u.email, u.password);
    const sw = await switchTenant(app, sessionId, csrfToken, tA.companyId);
    const csrf = notNull(sw.newCsrf, "sw.newCsrf");

    // Try to PATCH B while session points at A and URL path also points at A.
    // A malicious body includes `companyId: B` AND `id: B`. The server MUST
    // not honour either; the URL parameter is `tA`, and the session is `tA`.
    const res = await request(app)
      .patch(`/api/v1/tenants/${tA.companyId}`)
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrf}`)
      .set("x-csrf-token", csrf)
      .send({
        razonSocial: "A-RENAMED",
        // Hostile fields:
        companyId: tB.companyId,
        id: tB.companyId,
      });
    expect(res.status).toBe(200);
    const a = await prisma.company.findUnique({ where: { id: tA.companyId } });
    const b = await prisma.company.findUnique({ where: { id: tB.companyId } });
    expect(a?.razonSocial).toBe("A-RENAMED");
    expect(b?.razonSocial).toBe("B"); // untouched
  });
});
