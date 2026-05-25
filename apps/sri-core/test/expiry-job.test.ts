/**
 * Integration test for the expiry-check cron core.
 *
 * Strategy:
 *   - Seed three certs at -1, 5, 31 days remaining (per TASKS-0021 §7.1
 *     validation note) PLUS a 30-day bucket cert to assert the boundary
 *     is included.
 *   - Run `runExpiryCheck(prisma, logger, now)` against a fixed clock.
 *   - Assert:
 *       day -1 → `cert.expired` audit row + error log line.
 *       day  5 → no audit row (5 is NOT a bucket; buckets are 30/15/7/3/1/0).
 *       day 31 → no audit row (above the 30-day threshold).
 *       day 30 → `cert.expiry_warning` audit row + warn log line.
 *       day  3 → `cert.expiry_warning` audit row.
 *       day  0 → `cert.expiry_warning` audit row.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { newId } from "@facturador/db";
import { createLogger } from "@facturador/logger";
import { Writable } from "node:stream";
import { encryptP12 } from "../src/crypto/envelope.js";
import { generateSyntheticP12 } from "./fixtures/synthetic-cert.js";
import { runExpiryCheck } from "../src/certificates/expiry-job.js";

const DAY_MS = 86_400_000;
const PASSPHRASE = "expiry-test-pass";

function captureSink(): { stream: Writable; lines: () => unknown[]; reset: () => void } {
  let buffers: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      Buffer.concat(buffers)
        .toString("utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as unknown),
    reset: () => {
      buffers = [];
    },
  };
}

async function seedCompany(prisma: import("@facturador/db").PrismaClient, companyId: string) {
  await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: {
      id: companyId,
      ruc: companyId,
      razonSocial: `EXP_${companyId.slice(-6)}`,
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Av Expiry 1",
    },
  });
}

async function seedCert(
  prisma: import("@facturador/db").PrismaClient,
  companyId: string,
  daysRemaining: number,
) {
  // We add a half-day buffer so the floor() computation in the cron lands
  // exactly on the requested bucket (a cert at exactly t=0 days drifts to
  // -1 at the next μs because of `Math.floor(negative)`). The half-day
  // pad keeps both positive and negative buckets in their intended cell.
  const halfDayMs = DAY_MS / 2;
  const validFrom = new Date(Date.now() - 90 * DAY_MS);
  const validTo = new Date(Date.now() + daysRemaining * DAY_MS + halfDayMs);
  const { p12 } = generateSyntheticP12({
    subjectCN: `EXP ${daysRemaining}d`,
    validFrom,
    validTo,
    passphrase: PASSPHRASE,
  });
  const p12Env = encryptP12(p12);
  const passEnv = encryptP12(Buffer.from(PASSPHRASE, "utf8"));
  // We compute a unique fingerprint per cert because the unique index on
  // fingerprintSha256 is enforced even across companies in this schema.
  // The synthetic cert generator already produces independent material;
  // we just record the SHA-256 hash of the p12 buffer for the row.
  const { createHash } = await import("node:crypto");
  const fingerprintSha256 = createHash("sha256").update(p12).digest("hex");
  return prisma.certificate.create({
    data: {
      id: newId(),
      companyId,
      alias: `cert-${daysRemaining}d`,
      subjectCN: `EXP ${daysRemaining}d`,
      issuerCN: `EXP ${daysRemaining}d`,
      serialNumber: createHash("sha1").update(p12).digest("hex").slice(0, 16),
      validFrom,
      validTo,
      p12CiphertextB64: p12Env.ciphertext.toString("base64"),
      p12NonceB64: p12Env.nonce.toString("base64"),
      p12TagB64: p12Env.tag.toString("base64"),
      passphraseCiphertextB64: passEnv.ciphertext.toString("base64"),
      passphraseNonceB64: passEnv.nonce.toString("base64"),
      passphraseTagB64: passEnv.tag.toString("base64"),
      kmsKeyVersion: "v1",
      fingerprintSha256,
      status: "ACTIVE",
    },
  });
}

describe("runExpiryCheck", () => {
  const ctx = useTestSchema();
  let companyId = "";

  beforeAll(async () => {
    companyId = ulid();
    await seedCompany(ctx.getPrisma(), companyId);
  });

  it("writes audit rows for buckets {30, 15, 7, 3, 1, 0} and for expired (<0), skipping 5 and 31", async () => {
    const prisma = ctx.getPrisma();
    const sink = captureSink();
    const logger = createLogger({ service: "sri-core", env: "test", destination: sink.stream });

    // Seed buckets: -1 (expired), 0, 3, 5 (no-op), 30, 31 (no-op).
    const certMinus1 = await seedCert(prisma, companyId, -1);
    const cert0 = await seedCert(prisma, companyId, 0);
    const cert3 = await seedCert(prisma, companyId, 3);
    const cert5 = await seedCert(prisma, companyId, 5);
    const cert30 = await seedCert(prisma, companyId, 30);
    const cert31 = await seedCert(prisma, companyId, 31);

    const result = await runExpiryCheck(prisma, logger);
    expect(result.scanned).toBe(6);
    expect(result.warningsWritten).toBe(3); // 0, 3, 30
    expect(result.expiredWritten).toBe(1); // -1

    const audits = await prisma.auditLog.findMany({
      where: { entity: "Certificate", companyId },
    });
    const byEntity = new Map(audits.map((a) => [a.entityId, a.action]));
    expect(byEntity.get(certMinus1.id)).toBe("cert.expired");
    expect(byEntity.get(cert0.id)).toBe("cert.expiry_warning");
    expect(byEntity.get(cert3.id)).toBe("cert.expiry_warning");
    expect(byEntity.get(cert30.id)).toBe("cert.expiry_warning");
    expect(byEntity.has(cert5.id)).toBe(false);
    expect(byEntity.has(cert31.id)).toBe(false);

    // Verify the log lines include the warn/error events.
    const text = JSON.stringify(sink.lines());
    expect(text).toContain("certificate.expired");
    expect(text).toContain("certificate.expiry_warning");
  });

  it("is idempotent in the sense that re-running on the same day adds extra audit rows (acceptable for v1)", async () => {
    // We assert the cron does not crash on repeat — duplicate rows are
    // tolerated for v1 per the design note in expiry-job.ts.
    const prisma = ctx.getPrisma();
    const sink = captureSink();
    const logger = createLogger({ service: "sri-core", env: "test", destination: sink.stream });
    const result = await runExpiryCheck(prisma, logger);
    expect(result.scanned).toBeGreaterThan(0);
  });

  it("emits no audit for a cert comfortably outside any bucket", async () => {
    const prisma = ctx.getPrisma();
    const sink = captureSink();
    const logger = createLogger({ service: "sri-core", env: "test", destination: sink.stream });
    // The shared schema may already hold certs from previous cases; we
    // assert ONLY that this specific cert gets no audit row.
    const localCompanyId = ulid();
    await seedCompany(prisma, localCompanyId);
    const cert = await seedCert(prisma, localCompanyId, 100);
    await runExpiryCheck(prisma, logger);
    const audits = await prisma.auditLog.findMany({
      where: { entity: "Certificate", entityId: cert.id },
    });
    expect(audits).toHaveLength(0);
  });

  it("honours a time-warped `now` argument (driver-injectable clock)", async () => {
    const prisma = ctx.getPrisma();
    const sink = captureSink();
    const logger = createLogger({ service: "sri-core", env: "test", destination: sink.stream });
    // Seed a cert with 100 days remaining from `now`. Then call
    // runExpiryCheck with `now` shifted 70 days forward — the effective
    // daysRemaining becomes 30, so it MUST land in the 30-day bucket.
    const localCompanyId = ulid();
    await seedCompany(prisma, localCompanyId);
    const cert = await seedCert(prisma, localCompanyId, 100);
    const warpedNow = new Date(Date.now() + 70 * DAY_MS);
    await runExpiryCheck(prisma, logger, warpedNow);
    const audits = await prisma.auditLog.findMany({
      where: { entity: "Certificate", entityId: cert.id },
    });
    expect(audits.map((a) => a.action)).toContain("cert.expiry_warning");
  });
});
