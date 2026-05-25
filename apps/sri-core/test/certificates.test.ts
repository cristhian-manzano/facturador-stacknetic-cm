/**
 * Integration tests for `/v1/certificates/*`.
 *
 * Source of truth:
 *   - SPEC-0021 §6 (route surface + audit policy).
 *   - TASKS-0021 §3–§5 + §8 + §9.
 *   - PROMPT-0021 §5 (validation requirement).
 *
 * Strategy:
 *   - `useTestSchema` spawns a fresh Postgres schema per file.
 *   - The app is built via the test factory with a deterministic service
 *     JWT secret and `stubMode: true` (the cert routes don't reach SOAP,
 *     so the flag is irrelevant — set true to mirror `documents.test.ts`).
 *   - `generateSyntheticP12` produces a self-signed cert in memory; no
 *     real .p12 is committed.
 */
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { ulid } from "ulid";
import type { PrismaClient } from "@facturador/db";
import { useTestSchema } from "@facturador/db/test-harness";
import { mintServiceJwt } from "@facturador/utils/service-jwt";
import { ProblemDetailSchema } from "@facturador/contracts/errors";
import { generateSyntheticP12 } from "./fixtures/synthetic-cert.js";
import { createTestApp } from "./factory.js";
import { __resetActiveCertificateCache } from "../src/certificates/active.js";

/**
 * Create a Company row with the given id so the AuditLog FK is satisfied.
 * Tests scope every interaction through a per-schema Prisma client, so
 * the rows live exactly as long as the schema does.
 */
async function ensureCompany(prisma: PrismaClient, companyId: string): Promise<void> {
  // The ruc column is unique; we use the full companyId so collisions
  // are impossible even across rapid-fire ULID mints in the same ms.
  await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: {
      id: companyId,
      ruc: companyId,
      razonSocial: `TEST_${companyId.slice(-6)}`,
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Av Test 1",
    },
  });
}

const SECRET = "integration-test-service-jwt-secret-32-chars-of-entropy_";
const PASSPHRASE = "test-passphrase-1234";

const day = 86_400_000;

function uploadCert(opts: {
  app: import("express").Express;
  token: string;
  p12: Buffer;
  alias: string;
  passphrase?: string;
  filename?: string;
}) {
  return request(opts.app)
    .post("/v1/certificates")
    .set("Authorization", `Bearer ${opts.token}`)
    .set("X-Cert-Passphrase", opts.passphrase ?? PASSPHRASE)
    .field("alias", opts.alias)
    .attach("file", opts.p12, {
      filename: opts.filename ?? "test.p12",
      contentType: "application/x-pkcs12",
    });
}

describe("POST /v1/certificates — upload", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("uploads a valid .p12 and returns metadata only (no ciphertext)", async () => {
    const { app, getLines } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "UPLOAD HAPPY",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const res = await uploadCert({
      app,
      token,
      p12,
      alias: "primary",
    });
    expect(res.status).toBe(201);
    // SPEC-0021 §8 AC-6: response NEVER includes any of the ciphertext keys
    // or PEM material.
    const body = res.body as Record<string, unknown>;
    for (const key of [
      "p12CiphertextB64",
      "p12NonceB64",
      "p12TagB64",
      "passphraseCiphertextB64",
      "passphraseNonceB64",
      "passphraseTagB64",
      "certPem",
      "keyPem",
      "privateKey",
      "pem",
    ]) {
      expect(body[key]).toBeUndefined();
    }
    expect(body.subjectCN).toBe("UPLOAD HAPPY");
    expect(body.alias).toBe("primary");
    expect(body.status).toBe("INACTIVE");
    expect(body.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    // Audit row was written.
    const audits = await ctx.getPrisma().auditLog.findMany({
      where: { companyId, action: "cert.uploaded" },
    });
    expect(audits).toHaveLength(1);
    const auditRow = audits[0]!;
    expect(auditRow.entity).toBe("Certificate");
    // Make absolutely sure no log line carries any PEM material.
    const lines = getLines();
    const text = JSON.stringify(lines);
    expect(text).not.toContain("BEGIN CERTIFICATE");
    expect(text).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(text).not.toContain(PASSPHRASE);
  });

  it("rejects wrong passphrase with 422 / bad_passphrase", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "BAD PASS",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const res = await uploadCert({
      app,
      token,
      p12,
      alias: "bad",
      passphrase: "wrong",
    });
    expect(res.status).toBe(422);
    const pd = ProblemDetailSchema.parse(res.body);
    expect(pd.code).toBe("bad_passphrase");
  });

  it("rejects an expired cert with 422 / cert_expired", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "EXPIRED",
      validFrom: new Date(Date.now() - 10 * day),
      validTo: new Date(Date.now() - day),
      passphrase: PASSPHRASE,
    });
    const res = await uploadCert({ app, token, p12, alias: "expired" });
    expect(res.status).toBe(422);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("cert_expired");
  });

  it("rejects corrupt p12 with 422 / parse_failed", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const res = await uploadCert({
      app,
      token,
      p12: Buffer.from("definitely not a p12"),
      alias: "junk",
    });
    expect(res.status).toBe(422);
    const pd = ProblemDetailSchema.parse(res.body);
    expect(["parse_failed", "bad_passphrase"]).toContain(pd.code);
  });

  it("rejects duplicate fingerprint upload with 409 / conflict", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "DUP",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const first = await uploadCert({ app, token, p12, alias: "first" });
    expect(first.status).toBe(201);
    const second = await uploadCert({ app, token, p12, alias: "second" });
    expect(second.status).toBe(409);
    expect(ProblemDetailSchema.parse(second.body).code).toBe("conflict");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const res = await request(app).get("/v1/certificates");
    expect(res.status).toBe(401);
  });

  it("rejects oversize multipart with 413 / certificate.too_large", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const big = Buffer.alloc(5 * 1024 * 1024, 0xff); // 5 MB > 4 MB cap
    const res = await request(app)
      .post("/v1/certificates")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Cert-Passphrase", PASSPHRASE)
      .field("alias", "huge")
      .attach("file", big, {
        filename: "huge.p12",
        contentType: "application/x-pkcs12",
      });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("certificate.too_large");
  });

  it("rejects missing passphrase header with 400 / validation.failed", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "NO PASS HDR",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const res = await request(app)
      .post("/v1/certificates")
      .set("Authorization", `Bearer ${token}`)
      .field("alias", "no-pass")
      .attach("file", p12, {
        filename: "x.p12",
        contentType: "application/x-pkcs12",
      });
    expect(res.status).toBe(400);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("validation.failed");
  });
});

describe("GET /v1/certificates — list / get", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("lists only the caller's tenant certs, metadata only", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const ownerCompanyId = ulid();
    const otherCompanyId = ulid();
    await ensureCompany(ctx.getPrisma(), ownerCompanyId);
    await ensureCompany(ctx.getPrisma(), otherCompanyId);
    const ownerToken = await mintServiceJwt({
      companyId: ownerCompanyId,
      secret: SECRET,
    });
    const otherToken = await mintServiceJwt({
      companyId: otherCompanyId,
      secret: SECRET,
    });

    const a = generateSyntheticP12({
      subjectCN: "OWNER A",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const b = generateSyntheticP12({
      subjectCN: "OTHER B",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });

    await uploadCert({ app, token: ownerToken, p12: a.p12, alias: "owner-a" });
    await uploadCert({ app, token: otherToken, p12: b.p12, alias: "other-b" });

    const res = await request(app)
      .get("/v1/certificates")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const items = res.body.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    const first = items[0]!;
    expect(first.alias).toBe("owner-a");
    for (const key of [
      "p12CiphertextB64",
      "p12NonceB64",
      "p12TagB64",
      "passphraseCiphertextB64",
      "passphraseNonceB64",
      "passphraseTagB64",
      "certPem",
      "keyPem",
    ]) {
      expect(first[key]).toBeUndefined();
    }
  });

  it("returns 404 for a cert belonging to another tenant (no existence disclosure)", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const ownerCompanyId = ulid();
    const otherCompanyId = ulid();
    await ensureCompany(ctx.getPrisma(), ownerCompanyId);
    await ensureCompany(ctx.getPrisma(), otherCompanyId);
    const ownerToken = await mintServiceJwt({
      companyId: ownerCompanyId,
      secret: SECRET,
    });
    const otherToken = await mintServiceJwt({
      companyId: otherCompanyId,
      secret: SECRET,
    });
    const { p12 } = generateSyntheticP12({
      subjectCN: "X-TENANT",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const created = await uploadCert({
      app,
      token: ownerToken,
      p12,
      alias: "owner",
    });
    const certId = created.body.id as string;
    const res = await request(app)
      .get(`/v1/certificates/${certId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/certificates/:id/activate", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("activates atomically: only one ACTIVE per tenant at all times", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });

    const certA = generateSyntheticP12({
      subjectCN: "ACT A",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const certB = generateSyntheticP12({
      subjectCN: "ACT B",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const createdA = await uploadCert({
      app,
      token,
      p12: certA.p12,
      alias: "a",
    });
    const createdB = await uploadCert({
      app,
      token,
      p12: certB.p12,
      alias: "b",
    });

    // Activate the first.
    const activateA = await request(app)
      .post(`/v1/certificates/${createdA.body.id}/activate`)
      .set("Authorization", `Bearer ${token}`);
    expect(activateA.status).toBe(200);
    expect(activateA.body.status).toBe("ACTIVE");
    const after1 = await ctx.getPrisma().certificate.findMany({
      where: { companyId, status: "ACTIVE" },
    });
    expect(after1).toHaveLength(1);
    expect(after1[0]!.id).toBe(createdA.body.id);

    // Activate the second — the first must become INACTIVE.
    const activateB = await request(app)
      .post(`/v1/certificates/${createdB.body.id}/activate`)
      .set("Authorization", `Bearer ${token}`);
    expect(activateB.status).toBe(200);
    const after2 = await ctx.getPrisma().certificate.findMany({
      where: { companyId, status: "ACTIVE" },
    });
    expect(after2).toHaveLength(1);
    expect(after2[0]!.id).toBe(createdB.body.id);

    // Audit rows: 1 cert.activated for A, 1 for B, and 1 cert.deactivated for A.
    const audits = await ctx.getPrisma().auditLog.findMany({
      where: { companyId, entity: "Certificate" },
      orderBy: { createdAt: "asc" },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("cert.activated");
    expect(actions).toContain("cert.deactivated");
  });

  it("returns 404 when activating a nonexistent id", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const res = await request(app)
      .post(`/v1/certificates/${ulid()}/activate`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/certificates/:id", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("returns 204 when deleting INACTIVE", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "DEL OK",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const created = await uploadCert({
      app,
      token,
      p12,
      alias: "del-ok",
    });
    const res = await request(app)
      .delete(`/v1/certificates/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    const row = await ctx
      .getPrisma()
      .certificate.findUnique({ where: { id: created.body.id as string } });
    expect(row!.deletedAt).not.toBeNull();
  });

  it("returns 409 / cannot_delete_active when deleting ACTIVE", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "DEL ACT",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const created = await uploadCert({ app, token, p12, alias: "active" });
    await request(app)
      .post(`/v1/certificates/${created.body.id}/activate`)
      .set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .delete(`/v1/certificates/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(ProblemDetailSchema.parse(res.body).code).toBe("cannot_delete_active");
  });
});

describe("getActiveCertificate via API round-trip", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("activate → getActiveCertificate returns PEMs matching the uploaded cert", async () => {
    const { app } = createTestApp({
      prisma: ctx.getPrisma(),
      serviceJwtSecret: SECRET,
      stubMode: true,
    });
    const companyId = ulid();
    await ensureCompany(ctx.getPrisma(), companyId);
    const token = await mintServiceJwt({ companyId, secret: SECRET });
    const { p12 } = generateSyntheticP12({
      subjectCN: "FOR SIGNING",
      validFrom: new Date(Date.now() - day),
      validTo: new Date(Date.now() + 60 * day),
      passphrase: PASSPHRASE,
    });
    const created = await uploadCert({
      app,
      token,
      p12,
      alias: "signing",
    });
    await request(app)
      .post(`/v1/certificates/${created.body.id}/activate`)
      .set("Authorization", `Bearer ${token}`);
    const { getActiveCertificate } = await import("../src/certificates/active.js");
    const active = await getActiveCertificate(ctx.getPrisma(), companyId);
    expect(active.subjectCN).toBe("FOR SIGNING");
    expect(active.certPem.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(active.keyPem.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });
});
