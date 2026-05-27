/**
 * Integration tests for `/v1/documents/*` — the api ↔ sri-core round-trip.
 *
 * Source of truth:
 *   - SPEC-0020 §6.5 (route surface).
 *   - PROMPT-0020 §5 (negative-path matrix).
 *   - TASKS-0020 §6.1 / §6.2 / §6.3 / §7.1.
 *
 * Strategy:
 *   - `useTestSchema` spawns a fresh Postgres schema per test file (parallel-safe).
 *   - The app is built via the test factory with a deterministic
 *     `serviceJwtSecret` and `stubMode: true`.
 *   - api's `mintServiceJwt` mints real tokens against the same secret —
 *     this proves the full minter/verifier path, not a stubbed one.
 *   - Negative cases hand-craft tokens with the wrong claims to exercise
 *     every PROMPT-0020 rejection branch.
 *
 * No real network: Supertest drives the express app in-process. MSW is
 * not used here because we want the real verifier to run.
 */
import { SignJWT } from "jose";
import request from "supertest";
import { ulid } from "ulid";
import { describe, expect, it } from "vitest";

import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { computeClaveAccesoCheckDigit } from "@facturador/contracts/primitives";
import { EmitDocumentResponseSchema } from "@facturador/contracts/sri";
import { useTestSchema } from "@facturador/db/test-harness";
import { mintServiceJwt } from "@facturador/utils/service-jwt";

import { createTestApp } from "./factory.js";

const SECRET = "integration-test-service-jwt-secret-32-chars-of-entropy_";

function buildEmitPayload(opts: { companyId: string; secuencial?: string }) {
  const secuencial = (opts.secuencial ?? "000000001").padStart(9, "0");
  const base48 =
    "21052026" + // ddMMyyyy (synthetic — must be 8 digits)
    "01" + // codDoc factura
    "1790012345001" + // synthetic RUC sociedad
    "1" + // ambiente pruebas
    "001001" + // estab + ptoEmi
    secuencial + // 9 digit secuencial
    "12345678" + // codigoNumerico (random 8 digits)
    "1"; // tipoEmision normal
  const claveAcceso = base48 + computeClaveAccesoCheckDigit(base48);
  return {
    companyId: opts.companyId,
    ambiente: "1" as const,
    codDoc: "01" as const,
    estab: "001",
    ptoEmi: "001",
    secuencial,
    claveAcceso,
    fechaEmision: "21/05/2026",
    tipoEmision: "1" as const,
    factura: {
      // SPEC-0020 leaves the factura blob opaque at this contract layer.
      placeholder: "stub-payload",
    },
  };
}

describe("POST /v1/documents/emit (api ↔ sri-core round-trip)", () => {
  const ctx = useTestSchema();

  it("emits a document in stub mode and persists the SriDocument + AUTORIZADO events", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId });
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(payload);
    expect(res.status).toBe(200);
    const parsed = EmitDocumentResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.estado).toBe("AUTORIZADO");
    expect(parsed.data.numeroAutorizacion).toBe(`STUB-${payload.claveAcceso}`);

    // DB introspection: 1 SriDocument row, ≥ 1 SriEvent rows.
    const docs = await ctx.getPrisma().sriDocument.findMany({
      where: { claveAcceso: payload.claveAcceso },
    });
    expect(docs).toHaveLength(1);
    const persistedDoc = docs[0];
    if (persistedDoc === undefined) throw new Error("expected 1 row");
    expect(persistedDoc.companyId).toBe(companyId);
    const events = await ctx.getPrisma().sriEvent.findMany({
      where: { documentId: persistedDoc.id },
    });
    // Stub mode walks BUILD → SIGN → SEND → RECEIVE → AUTHORIZE (5 events).
    expect(events.length).toBeGreaterThanOrEqual(5);
    const etapas = events.map((e) => e.etapa).sort();
    expect(etapas).toEqual(["AUTHORIZE", "BUILD", "RECEIVE", "SEND", "SIGN"]);
  });

  it("is idempotent — a second emit with the same claveAcceso reuses the row", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId, secuencial: "000000002" });
    await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(res.status).toBe(200);
    const rows = await ctx
      .getPrisma()
      .sriDocument.findMany({ where: { claveAcceso: payload.claveAcceso } });
    expect(rows).toHaveLength(1);
  });

  it("non-stub mode runs the orchestrator and lands ERROR_BUILD on a placeholder payload", async () => {
    // Pre-SPEC-0026 the route returned PENDIENTE and left the pipeline
    // to a later worker. Post-SPEC-0026 the orchestrator runs
    // synchronously: with a non-factura payload the BUILD step rejects
    // the input and transitions to ERROR_BUILD (a terminal state).
    // A real-factura non-stub test lives in `lifecycle-emit.test.ts`
    // where SOAP clients are mocked explicitly.
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: false,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId, secuencial: "000000003" });
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("ERROR_BUILD");
  });
});

describe("GET /v1/documents/:claveAcceso/status", () => {
  const ctx = useTestSchema();

  it("returns the document + events scoped to the JWT companyId", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId, secuencial: "000000004" });
    await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    const res = await request(app)
      .get(`/v1/documents/${payload.claveAcceso}/status`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.document.claveAcceso).toBe(payload.claveAcceso);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 when the claveAcceso doesn't belong to this tenant", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const ownerCompanyId = ulid();
    const otherCompanyId = ulid();
    const ownerToken = await mintServiceJwt({ companyId: ownerCompanyId, secret: SECRET });
    const otherToken = await mintServiceJwt({ companyId: otherCompanyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId: ownerCompanyId, secuencial: "000000005" });
    await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(payload);
    const res = await request(app)
      .get(`/v1/documents/${payload.claveAcceso}/status`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});

describe("Negative-path matrix (PROMPT-0020 §5)", () => {
  const ctx = useTestSchema();

  it("401 when Authorization header is missing", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const payload = buildEmitPayload({ companyId: ulid() });
    const res = await request(app).post("/v1/documents/emit").send(payload);
    expect(res.status).toBe(401);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("sri.service_token_invalid");
  });

  it("401 when audience is wrong", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("api")
      .setAudience("not-sri-core")
      .setSubject(companyId)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(new TextEncoder().encode(SECRET));
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(buildEmitPayload({ companyId }));
    expect(res.status).toBe(401);
  });

  it("401 when alg is none (alg confusion)", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        iss: "api",
        aud: "sri-core",
        sub: companyId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30,
      }),
    ).toString("base64url");
    const token = `${header}.${body}.`;
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(buildEmitPayload({ companyId }));
    expect(res.status).toBe(401);
  });

  it("403 when JWT sub mismatches body.companyId", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const jwtCompanyId = ulid();
    const bodyCompanyId = ulid();
    const token = await mintServiceJwt({ companyId: jwtCompanyId, secret: SECRET });
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(buildEmitPayload({ companyId: bodyCompanyId }));
    expect(res.status).toBe(403);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("tenant.forbidden");
  });

  it("400 when body is missing claveAcceso", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const payload = buildEmitPayload({ companyId });
    const { claveAcceso: _omit, ...bad } = payload;
    void _omit;
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(bad);
    expect(res.status).toBe(400);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("validation.failed");
  });

  it("401 when token is expired (5s clock tolerance still rejects > 60s old)", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("api")
      .setAudience("sri-core")
      .setSubject(companyId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3500)
      .sign(new TextEncoder().encode(SECRET));
    const res = await request(app)
      .post("/v1/documents/emit")
      .set("Authorization", `Bearer ${token}`)
      .send(buildEmitPayload({ companyId }));
    expect(res.status).toBe(401);
  });
});

describe("Health route", () => {
  const ctx = useTestSchema();

  it("GET /healthz returns 200 without auth", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "sri-core" });
  });

  it("GET /readyz returns 200 with the test DB connected", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", db: "ok" });
  });
});
