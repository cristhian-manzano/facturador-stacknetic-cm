/**
 * Smoke test for SPEC-0021: generate a synthetic .p12, upload via the
 * real HTTP server, list, activate, fetch metadata.
 *
 * Runs against a sri-core boot pointed at the dev Postgres. The DB must
 * be reachable (DATABASE_URL from .env) — start the stack with
 * `docker compose up -d db`. We mint a service JWT against
 * `SERVICE_JWT_SECRET` for a synthetic `companyId` that we create on the
 * fly, then drop afterwards.
 *
 * Usage:
 *   pnpm --filter @facturador/sri-core exec tsx scripts/smoke-cert-upload.ts
 *
 * Outputs the metadata of every step. Exits non-zero on any unexpected
 * status.
 */
import { generateKeyPairSync } from "node:crypto";
import { ulid } from "ulid";
import { Writable } from "node:stream";
import { mintServiceJwt } from "@facturador/utils/service-jwt";
import { createLogger } from "@facturador/logger";
import { prisma } from "@facturador/db";
import forge from "node-forge";
import { createApp } from "../src/server.js";
import { env } from "../src/env.js";

async function generateP12(passphrase: string): Promise<Buffer> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  const pub = forge.pki.rsa.setPublicKey(forgeKey.n, forgeKey.e);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber =
    "01" +
    ulid()
      .slice(0, 12)
      .toLowerCase()
      .replace(/[^0-9a-f]/g, "0");
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const dn = [{ shortName: "CN", value: "SMOKE TEST CERT" }];
  cert.setSubject(dn);
  cert.setIssuer(dn);
  cert.sign(forgeKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], passphrase, {
    friendlyName: "SMOKE",
    algorithm: "3des",
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

async function main(): Promise<void> {
  // Quiet logger (don't print PEM material).
  const logger = createLogger({
    service: "sri-core",
    env: "development",
    destination: new Writable({ write: (_c, _e, cb) => cb() }),
  });
  const app = createApp({ logger });
  // Bind to an ephemeral port so the smoke doesn't fight with anything
  // already on env.SRI_CORE_PORT.
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("smoke: failed to determine bound port");
  }
  const port = address.port;

  const companyId = ulid();
  await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: {
      id: companyId,
      ruc: companyId,
      razonSocial: `SMOKE_${companyId.slice(-6)}`,
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Smoke Av 1",
    },
  });
  const token = await mintServiceJwt({
    companyId,
    secret: env.SERVICE_JWT_SECRET,
  });

  try {
    const passphrase = "smoke-test-pass";
    const p12 = await generateP12(passphrase);

    // Upload via real HTTP using global fetch (Node 22).
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(p12)], { type: "application/x-pkcs12" }),
      "smoke.p12",
    );
    form.append("alias", "smoke");
    const uploadRes = await fetch(`http://127.0.0.1:${port}/v1/certificates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Cert-Passphrase": passphrase,
      },
      body: form,
    });
    if (uploadRes.status !== 201) {
      const body = await uploadRes.text();
      throw new Error(`upload failed: ${String(uploadRes.status)} ${body}`);
    }
    const uploadBody = (await uploadRes.json()) as {
      id: string;
      subjectCN: string;
      fingerprintSha256: string;
      status: string;
    };
    process.stdout.write(
      `[smoke] uploaded id=${uploadBody.id} cn=${uploadBody.subjectCN} fp=${uploadBody.fingerprintSha256.slice(0, 8)}...\n`,
    );

    // GET metadata.
    const getRes = await fetch(`http://127.0.0.1:${port}/v1/certificates/${uploadBody.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (getRes.status !== 200) {
      throw new Error(`get failed: ${String(getRes.status)}`);
    }
    const getBody = (await getRes.json()) as Record<string, unknown>;
    process.stdout.write(
      `[smoke] get returned subjectCN=${String(getBody.subjectCN)} status=${String(getBody.status)}\n`,
    );
    for (const forbidden of [
      "p12CiphertextB64",
      "p12NonceB64",
      "p12TagB64",
      "certPem",
      "keyPem",
      "passphrase",
      "passphraseCiphertextB64",
    ]) {
      if (getBody[forbidden] !== undefined) {
        throw new Error(`leak: ${forbidden} present in GET response`);
      }
    }

    // Activate.
    const actRes = await fetch(
      `http://127.0.0.1:${port}/v1/certificates/${uploadBody.id}/activate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (actRes.status !== 200) {
      throw new Error(`activate failed: ${String(actRes.status)}`);
    }
    const actBody = (await actRes.json()) as { status: string };
    process.stdout.write(`[smoke] activate set status=${actBody.status}\n`);

    // Cleanup: hard-delete the test company + its cert + audit rows so the
    // dev DB stays tidy. We do this via raw queries because the Cert
    // table has no soft-delete cascade and the API DELETE refuses ACTIVE.
    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.certificate.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    process.stdout.write("[smoke] OK (smoke artefacts cleaned)\n");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[smoke] FAILED: ${String((err as Error).message)}\n`);
  process.exit(1);
});
