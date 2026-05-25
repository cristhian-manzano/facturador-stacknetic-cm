/**
 * Integration test for `runSignStep` (TASKS-0024 §5).
 *
 * Validates:
 *   - A PENDIENTE document transitions to FIRMADO after the sign step.
 *   - An `SriEvent { etapa: SIGN, estado: FIRMADO }` row is appended.
 *   - The signed XML is persisted into the BlobStore under a stable key.
 *   - The document's `signedXmlBlobKey` is updated.
 *   - No private key material leaks into the captured log stream.
 *   - The signer's algo (SHA-1 default) is reflected in the resulting
 *     `result.algo`.
 *
 * Strategy:
 *   - `useTestSchema` spins up a fresh Postgres schema per file.
 *   - The active certificate is seeded directly via Prisma (uploading a
 *     full .p12 through the route is exercised by `certificates.test.ts`
 *     — we don't need to repeat that integration here). The encrypted
 *     blob is produced by the envelope helper so the active-cert
 *     decrypt path runs exactly as in production.
 *   - The XML to sign comes from the golden fixture.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { ulid } from "ulid";
import { useTestSchema } from "@facturador/db/test-harness";
import { createLogger } from "@facturador/logger";
import { Writable } from "node:stream";
import { encryptP12 } from "../src/crypto/envelope.js";
import { __resetActiveCertificateCache } from "../src/certificates/active.js";
import { buildFacturaXml } from "../src/xml/factura.js";
import { runSignStep } from "../src/lifecycle/sign-step.js";
import { InMemoryBlobStore } from "../src/lifecycle/blob-store.js";
import { generateSyntheticP12 } from "./fixtures/synthetic-cert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const day = 86_400_000;

/**
 * Encrypt the .p12 bytes with the active envelope key so the row can be
 * decrypted by `getActiveCertificate`. The envelope code path expects the
 * master key to be present as a 64-char hex; we use a deterministic
 * value scoped to the test process so the helper's env validator does
 * not refuse.
 */
function ensureMasterKeyHex(): string {
  const key = process.env["SRI_CERT_MASTER_KEY_HEX"] ?? "0".repeat(64); // 32 bytes of zeros — test-only, never used at rest
  // active.ts reads the env once at module load; we just need encryptP12
  // to use the same key here.
  return key;
}

async function seedActiveCert(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
  subjectCN?: string;
  validTo?: Date;
}): Promise<void> {
  const { prisma, companyId } = args;
  const subjectCN = args.subjectCN ?? "Sign-Step Subject";
  const validTo = args.validTo ?? new Date(Date.now() + 365 * day);
  const passphrase = "test-pass";
  const { p12 } = generateSyntheticP12({
    subjectCN,
    validFrom: new Date(Date.now() - day),
    validTo,
    passphrase,
  });
  ensureMasterKeyHex();
  const envelope = encryptP12(p12);
  const passEnv = encryptP12(Buffer.from(passphrase, "utf8"));
  // The Certificate model's `fingerprintSha256` is a globally-unique key
  // (SPEC-0021 §6); each test row must have a distinct value. We derive
  // it from `companyId` + `subjectCN` so the helper produces stable but
  // non-colliding fingerprints across tests.
  const fp = Buffer.from(`${companyId}|${subjectCN}|${validTo.toISOString()}`)
    .toString("hex")
    .padEnd(64, "f")
    .slice(0, 64);
  await prisma.certificate.create({
    data: {
      id: ulid(),
      companyId,
      subjectCN,
      issuerCN: subjectCN,
      // The Prisma schema names the field `serialNumber`. Per SPEC-0021
      // the value is a hex string; we use a deterministic per-row value
      // so the (companyId, serialNumber) unique constraint never fires.
      serialNumber: Buffer.from(`${companyId}-${subjectCN}`).toString("hex").slice(0, 24),
      validFrom: new Date(Date.now() - day),
      validTo,
      fingerprintSha256: fp,
      alias: "primary",
      status: "ACTIVE",
      p12CiphertextB64: envelope.ciphertext.toString("base64"),
      p12NonceB64: envelope.nonce.toString("base64"),
      p12TagB64: envelope.tag.toString("base64"),
      passphraseCiphertextB64: passEnv.ciphertext.toString("base64"),
      passphraseNonceB64: passEnv.nonce.toString("base64"),
      passphraseTagB64: passEnv.tag.toString("base64"),
    },
  });
}

async function seedPendingDocument(args: {
  prisma: ReturnType<ReturnType<typeof useTestSchema>["getPrisma"]>;
  companyId: string;
  claveAcceso: string;
}): Promise<string> {
  const id = ulid();
  await args.prisma.sriDocument.create({
    data: {
      id,
      companyId: args.companyId,
      tipoComprobante: "01",
      claveAcceso: args.claveAcceso,
      ambiente: "1",
      estab: "001",
      ptoEmi: "001",
      secuencial: "000000001",
      fechaEmision: new Date("2026-05-21T00:00:00Z"),
      estado: "PENDIENTE",
    },
  });
  return id;
}

function captureSink(): { stream: Writable; read: () => string } {
  let buffers: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      cb();
    },
  });
  return { stream, read: () => Buffer.concat(buffers).toString("utf8") };
}

describe("runSignStep — lifecycle integration", () => {
  const ctx = useTestSchema();

  beforeAll(() => {
    __resetActiveCertificateCache();
  });

  it("PENDIENTE → FIRMADO with an SriEvent + blob key", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    await seedActiveCert({ prisma, companyId });

    const input = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "fixtures", "factura", "golden-01.input.json"),
        "utf8",
      ),
    ) as unknown;
    const { xmlForSigning } = buildFacturaXml(input);

    const docId = await seedPendingDocument({
      prisma,
      companyId,
      claveAcceso:
        "21052026" + "01" + "1790012345001" + "1" + "001001" + "000000020" + "12345678" + "1" + "0",
    });

    const sink = captureSink();
    const logger = createLogger({
      service: "sri-core",
      env: "test",
      destination: sink.stream,
    });
    const blobStore = new InMemoryBlobStore();

    const result = await runSignStep(
      { prisma, blobStore, logger },
      { documentId: docId, xmlForSigning },
    );

    expect(result.documentId).toBe(docId);
    expect(result.algo).toBe("SHA1");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.signedXmlBlobKey).toContain("signed.xml");

    // Document is FIRMADO with the blob key set.
    const refreshed = await prisma.sriDocument.findUniqueOrThrow({
      where: { id: docId },
    });
    expect(refreshed.estado).toBe("FIRMADO");
    expect(refreshed.signedXmlBlobKey).toBe(result.signedXmlBlobKey);

    // An SriEvent { etapa: SIGN, estado: FIRMADO } was appended.
    const events = await prisma.sriEvent.findMany({
      where: { documentId: docId, etapa: "SIGN", estado: "FIRMADO" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);

    // The blob store holds the signed XML.
    const stored = await blobStore.get(result.signedXmlBlobKey);
    expect(stored).not.toBeNull();
    expect(stored!).toContain("<ds:Signature");

    // No PEM material leaked into the log stream.
    const lines = sink.read();
    expect(lines).not.toContain("BEGIN CERTIFICATE");
    expect(lines).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(lines).not.toContain("BEGIN PRIVATE KEY");
    // The signedXml redaction is path-keyed. Even if a log line accidentally
    // names `signedXml`, the censor would replace the value. We assert the
    // log lines never include `<ds:Signature>` raw text either way.
    expect(lines).not.toContain("<ds:Signature");
  });

  it("propagates CERT_EXPIRED when the active cert is expired", async () => {
    const prisma = ctx.getPrisma();
    const companyId = ulid();
    // Seed a cert that expired 1 hour ago.
    await seedActiveCert({
      prisma,
      companyId,
      validTo: new Date(Date.now() - 3_600_000),
    });
    const input = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "fixtures", "factura", "golden-01.input.json"),
        "utf8",
      ),
    ) as unknown;
    const { xmlForSigning } = buildFacturaXml(input);
    const docId = await seedPendingDocument({
      prisma,
      companyId,
      claveAcceso:
        "21052026" + "01" + "1790012345001" + "1" + "001001" + "000000021" + "12345678" + "1" + "8",
    });
    const blobStore = new InMemoryBlobStore();
    await expect(
      runSignStep({ prisma, blobStore }, { documentId: docId, xmlForSigning }),
    ).rejects.toMatchObject({ code: "CERT_EXPIRED" });
    // The document stays PENDIENTE — the failure happened BEFORE recordEvent.
    const fresh = await prisma.sriDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(fresh.estado).toBe("PENDIENTE");
  });

  it("propagates NotFoundError when documentId does not exist", async () => {
    const prisma = ctx.getPrisma();
    const blobStore = new InMemoryBlobStore();
    await expect(
      runSignStep(
        { prisma, blobStore },
        { documentId: ulid(), xmlForSigning: '<factura id="comprobante"></factura>' },
      ),
    ).rejects.toMatchObject({ code: "sri_document.not_found" });
  });
});
