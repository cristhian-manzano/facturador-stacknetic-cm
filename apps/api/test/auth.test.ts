/**
 * Integration tests for SPEC-0010 — authentication & sessions.
 *
 * Per TASKS-0010 §8.1, this file exercises:
 *   - Login OK with the seed credentials: 200, Set-Cookie session + csrf,
 *     body validates LoginResponseSchema.
 *   - Login bad password: 401 + ProblemDetail.
 *   - Login non-existent email: 401, body BYTE-IDENTICAL to bad-password
 *     (apart from `instance` aka request id), and request duration similar.
 *   - /me with valid cookie: 200, MeResponseSchema.parse.
 *   - /me without cookie: 401.
 *   - Logout: 204, session row gone, subsequent /me → 401.
 *   - Mutating endpoint without CSRF: 403.
 *   - Mutating endpoint with mismatching CSRF: 403.
 *   - Mutating endpoint with valid CSRF: 204.
 *   - Login rate limit: per-IP threshold returns 429 with ProblemDetail.
 *   - Session expiry: artificially-expired row → /me returns 401.
 *
 * All tests run against a per-test Postgres schema via `useTestSchema()`
 * from `@facturador/db/test-harness`, so they're parallel-safe and don't
 * leak data into the shared dev schema.
 *
 * A seed Company + User + Membership is inserted once per describe block
 * because Postgres schemas start empty. The seed password is hashed with
 * the exact same parameters as production code (we delegate to the
 * `hashPassword` helper).
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { LoginResponseSchema, MeResponseSchema } from "@facturador/contracts/auth";
import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { createApp } from "../src/server.js";
import { hashPassword } from "../src/auth/password.js";
import { createTestApp } from "./factory.js";

// `Role` enum mirrored locally so tests don't need to add `@prisma/client`
// as a direct devDep. The values are stable per Prisma schema (SPEC-0004).
const Role = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  ACCOUNTANT: "ACCOUNTANT",
  OPERATOR: "OPERATOR",
  VIEWER: "VIEWER",
} as const;

const SEED_RUC = "9999000099001";
const SEED_EMAIL = "auth-tester@facturador.test";
const SEED_PASSWORD = "AuthTest!123";

// Cookie shorthand for the session + csrf cookie names used in
// non-production. The `cookies.ts` module exports the same constants but
// keeping the literal here is fine because production names are gated by
// NODE_ENV — and the tests always run with NODE_ENV=test.
const SESSION_COOKIE = "facturador_session";
const CSRF_COOKIE = "facturador_csrf";

// Helper: parse the first cookie of a given name from a Set-Cookie array.
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

/**
 * Idempotent seed for the per-schema admin user. Calling this twice in the
 * same describe block (one `beforeAll` + a paranoid double-call inside a
 * test) is a no-op on the second call — we look up by RUC/email and skip.
 */
async function seedAdmin(prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>) {
  const existing = await prisma.user.findUnique({ where: { email: SEED_EMAIL } });
  if (existing !== null) {
    const membership = await prisma.membership.findFirst({
      where: { userId: existing.id },
    });
    return { companyId: membership?.companyId ?? "", userId: existing.id };
  }
  const companyId = ulid();
  const userId = ulid();
  await prisma.company.create({
    data: {
      id: companyId,
      ruc: SEED_RUC,
      razonSocial: "AUTH TESTER S.A.",
      nombreComercial: "Auth Tester",
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Calle Auth 1, Quito",
      obligadoContabilidad: false,
    },
  });
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await prisma.user.create({
    data: {
      id: userId,
      email: SEED_EMAIL,
      passwordHash,
      displayName: "Auth Tester",
      isSuperadmin: false,
    },
  });
  await prisma.membership.create({
    data: { id: ulid(), userId, companyId, role: Role.OWNER },
  });
  return { companyId, userId };
}

describe("POST /api/v1/auth/login", () => {
  const ctx = useTestSchema();

  it("returns 200 with valid cookies and a parseable body on correct credentials", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD })
      .set("content-type", "application/json");

    expect(res.status).toBe(200);

    // Set-Cookie must contain BOTH cookies.
    const cookieHeader = res.headers["set-cookie"] as string[] | undefined;
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader?.length).toBeGreaterThanOrEqual(2);
    const setCookieJoined = (cookieHeader ?? []).join("\n");
    expect(setCookieJoined).toMatch(/facturador_session=/);
    expect(setCookieJoined).toMatch(/facturador_csrf=/);
    // Session cookie MUST be HttpOnly; CSRF cookie MUST NOT be.
    const sessionLine = (cookieHeader ?? []).find((l) => l.startsWith("facturador_session="));
    const csrfLine = (cookieHeader ?? []).find((l) => l.startsWith("facturador_csrf="));
    expect(sessionLine).toMatch(/HttpOnly/i);
    expect(sessionLine).toMatch(/SameSite=Lax/i);
    expect(sessionLine).toMatch(/Path=\//);
    expect(csrfLine).not.toMatch(/HttpOnly/i);
    expect(csrfLine).toMatch(/SameSite=Lax/i);

    // Body shape.
    const parsed = LoginResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.user.email).toBe(SEED_EMAIL);
    expect(parsed.data.memberships).toHaveLength(1);
    expect(parsed.data.csrfToken.length).toBeGreaterThan(0);

    // The session row must exist.
    const sessionCount = await prisma.session.count();
    expect(sessionCount).toBe(1);
  });

  it("returns 401 + generic ProblemDetail on bad password", async () => {
    const prisma = ctx.getPrisma();
    // Seed only if not already present.
    if ((await prisma.user.count()) === 0) {
      await seedAdmin(prisma);
    }
    const { app } = createTestApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: "WRONG-password-zzz" });

    expect(res.status).toBe(401);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.code).toBe("auth.invalid_credentials");
    expect(parsed.data.status).toBe(401);
  });

  it("returns a BYTE-IDENTICAL body for 'unknown email' vs 'wrong password' (except instance)", async () => {
    const prisma = ctx.getPrisma();
    if ((await prisma.user.count()) === 0) {
      await seedAdmin(prisma);
    }
    const { app } = createTestApp({ prisma });

    const wrongPwd = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: "WRONG-password-zzz" });

    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@facturador.test", password: "ZZZ-pwd-zzz-1!" });

    expect(wrongPwd.status).toBe(401);
    expect(unknownEmail.status).toBe(401);

    // Both bodies validate the same shape.
    expect(ProblemDetailSchema.safeParse(wrongPwd.body).success).toBe(true);
    expect(ProblemDetailSchema.safeParse(unknownEmail.body).success).toBe(true);

    // Strip the request-id ("instance") from each body and assert deep equality.
    const stripInstance = (body: unknown): unknown => {
      const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      delete copy.instance;
      return copy;
    };
    expect(stripInstance(wrongPwd.body)).toEqual(stripInstance(unknownEmail.body));
  });

  it("returns 400 (NOT 401) on a malformed body (e.g. missing email)", async () => {
    const prisma = ctx.getPrisma();
    if ((await prisma.user.count()) === 0) {
      await seedAdmin(prisma);
    }
    const { app } = createTestApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ password: "no-email-supplied" });

    expect(res.status).toBe(400);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.code).toBe("validation.failed");
  });
});

describe("Login rate limit", () => {
  const ctx = useTestSchema();

  it("returns 429 with ProblemDetail on the 6th request in a minute (per-IP limit=5)", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    // Drive 5 attempts (5 = the per-IP threshold). The 6th must be blocked.
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: SEED_EMAIL, password: "WRONG-password-zzz" });
      // Anything 4xx is fine; we just want the bucket consumed.
      expect([200, 401, 400]).toContain(r.status);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: "WRONG-password-zzz" });
    expect(blocked.status).toBe(429);
    const parsed = ProblemDetailSchema.safeParse(blocked.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.code).toBe("rate_limited");
  });
});

describe("GET /api/v1/me", () => {
  const ctx = useTestSchema();

  it("returns 401 without a cookie", async () => {
    const { app } = createTestApp({ prisma: ctx.getPrisma() });
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  it("returns 200 + MeResponse with a valid session cookie", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    expect(login.status).toBe(200);

    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);

    const res = await request(app)
      .get("/api/v1/me")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}`);

    expect(res.status).toBe(200);
    const parsed = MeResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.user.email).toBe(SEED_EMAIL);
    expect(parsed.data.memberships).toHaveLength(1);
  });
});

describe("POST /api/v1/auth/logout", () => {
  const ctx = useTestSchema();

  it("deletes the session row, clears cookies, and /me returns 401 afterwards", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken);
    expect(logoutRes.status).toBe(204);

    expect(await prisma.session.count()).toBe(0);

    // Subsequent /me with the now-stale cookie must 401.
    const me = await request(app).get("/api/v1/me").set("cookie", `${SESSION_COOKIE}=${sessionId}`);
    expect(me.status).toBe(401);
  });
});

describe("CSRF protection on mutating endpoints", () => {
  const ctx = useTestSchema();

  it("rejects 403 when X-CSRF-Token header is missing", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);

    const res = await request(app)
      .post("/api/v1/_diag/csrf-check")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`);
    expect(res.status).toBe(403);
    const parsed = ProblemDetailSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.code).toBe("csrf.invalid");
  });

  it("rejects 403 when X-CSRF-Token mismatches the cookie", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);

    const res = await request(app)
      .post("/api/v1/_diag/csrf-check")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", "this-is-not-the-real-token");
    expect(res.status).toBe(403);
  });

  it("passes through when CSRF cookie + header + stored hash all match", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);

    const res = await request(app)
      .post("/api/v1/_diag/csrf-check")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken);
    expect(res.status).toBe(204);
  });
});

describe("Session expiry", () => {
  const ctx = useTestSchema();

  it("rejects 401 when the session's expiresAt is in the past", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);

    // Force the session into the past.
    const past = new Date(Date.now() - 60_000);
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: past, lastSeenAt: past },
    });

    const me = await request(app).get("/api/v1/me").set("cookie", `${SESSION_COOKIE}=${sessionId}`);
    expect(me.status).toBe(401);
  });
});

describe("Audit events", () => {
  const ctx = useTestSchema();

  it("writes auth.login.success on successful login and auth.login.failure on bad creds", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    // Bad password → audit row with action `auth.login.failure`.
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: "WRONG-password-zzz" });

    // Good password → audit row with action `auth.login.success`.
    const ok = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    expect(ok.status).toBe(200);

    const failure = await prisma.auditLog.findFirst({ where: { action: "auth.login.failure" } });
    expect(failure).not.toBeNull();
    // No password literal anywhere in the audit payload.
    if (failure?.payloadJson !== null && failure?.payloadJson !== undefined) {
      expect(JSON.stringify(failure.payloadJson)).not.toContain("WRONG-password-zzz");
    }

    const success = await prisma.auditLog.findFirst({ where: { action: "auth.login.success" } });
    expect(success).not.toBeNull();
    // No password literal in success payload either.
    if (success !== null) {
      expect(JSON.stringify(success.payloadJson ?? null)).not.toContain(SEED_PASSWORD);
    }
  });

  it("writes auth.logout on logout", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    const { app } = createTestApp({ prisma });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | undefined;
    const sessionId = extractCookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = extractCookieValue(setCookie, CSRF_COOKIE);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("cookie", `${SESSION_COOKIE}=${sessionId}; ${CSRF_COOKIE}=${csrfToken}`)
      .set("x-csrf-token", csrfToken);
    expect(logoutRes.status).toBe(204);

    const row = await prisma.auditLog.findFirst({ where: { action: "auth.logout" } });
    expect(row).not.toBeNull();
  });
});

describe("Constant-time login timing (sanity)", () => {
  const ctx = useTestSchema();

  it("'unknown email' and 'wrong password' paths take similar durations", async () => {
    const prisma = ctx.getPrisma();
    await seedAdmin(prisma);
    // Create a vanilla Express app (no test-logger sink) so the timing
    // measurement reflects the production code path. A fresh app means
    // fresh in-memory rate-limit buckets.
    const app = createApp({ prisma });

    // Budget: per-IP rate limit defaults to 5/min. We do exactly 4 login
    // attempts (2 wrong-password + 2 unknown-email), then stop. That keeps
    // us under the threshold and still gives a measurable signal.
    const samples = 2;
    const tWrong: number[] = [];
    const tUnknown: number[] = [];
    // Use password values that are >= 8 chars (the LoginRequestSchema floor)
    // so the validator passes and the handler actually runs argon2.
    for (let i = 0; i < samples; i += 1) {
      const a = process.hrtime.bigint();
      const r1 = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: SEED_EMAIL, password: `wrong-password-${String(i)}` });
      const b = process.hrtime.bigint();
      // Only collect 401 responses (the constant-time path we care about).
      // Skip 429s (rate-limited; no argon2 happened) and other statuses.
      if (r1.status === 401) tWrong.push(Number(b - a) / 1e6);

      const c = process.hrtime.bigint();
      const r2 = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: `ghost-${String(i)}@facturador.test`,
          password: `wrong-password-${String(i)}`,
        });
      const d = process.hrtime.bigint();
      if (r2.status === 401) tUnknown.push(Number(d - c) / 1e6);
    }

    expect(tWrong.length).toBeGreaterThan(0);
    expect(tUnknown.length).toBeGreaterThan(0);

    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const wrongMean = mean(tWrong);
    const unknownMean = mean(tUnknown);

    // The argon2 verify alone is ~50-150 ms depending on hardware. We
    // assert both means stay above a generous lower bound (>20 ms) so a
    // regression that accidentally skipped the DUMMY_HASH path on the
    // unknown-email branch (which would drop to sub-millisecond) fails
    // loudly. The ratio bound (<5×) covers normal jitter on CI.
    expect(wrongMean).toBeGreaterThan(20);
    expect(unknownMean).toBeGreaterThan(20);
    const ratio = Math.max(wrongMean, unknownMean) / Math.min(wrongMean, unknownMean);
    expect(ratio).toBeLessThan(5);
  });
});
