#!/usr/bin/env tsx
/**
 * Smoke automation for the SRI clients (RecepcionClient + AutorizacionClient).
 *
 * Source of truth: audit-punchlist Item 9 (REVIEW-0025 §11 #5).
 *
 * Goal: end-to-end happy-path validation that a synthetic, signed
 * factura can be submitted to SRI pruebas and reach AUTORIZADO. This
 * script is NOT run in CI — it requires a real .p12 + network path to
 * `celcer.sri.gob.ec`. It's meant for operator-driven smoke after a
 * deploy or upon SRI infrastructure changes.
 *
 * Inputs (env-only):
 *   - SRI_TEST_P12_PATH        Path to the test taxpayer's .p12 cert.
 *   - SRI_TEST_PASSPHRASE      Passphrase for the .p12.
 *   - SRI_TEST_CLAVE_ACCESO    Synthetic claveAcceso (49 digits) — the
 *                              caller MUST allocate this from a test
 *                              secuencial so re-runs don't collide
 *                              with previously-emitted documents.
 *   - SRI_RECEPCION_URL_PRUEBAS, SRI_AUTORIZACION_URL_PRUEBAS — from
 *                              the standard .env.
 *
 * Pipeline:
 *   1. Parse the .p12 → get certPem + keyPem + subject.
 *   2. Build a minimal valid factura via `buildFacturaXml` from a
 *      checked-in fixture. The fixture's clave-acceso is overridden
 *      with `SRI_TEST_CLAVE_ACCESO`.
 *   3. Sign + canonicalise.
 *   4. Submit to recepción.
 *   5. Poll autorización every 3 s up to 30 attempts (90 s ceiling).
 *   6. Exit 0 on AUTORIZADO; exit 1 with a summary otherwise.
 *
 * The script never prints the signed XML, the autorised XML, the
 * passphrase, or the certificate bytes — only state machine markers
 * and identifiers.
 */
/* eslint-disable no-console -- operator-facing tool with stdout summary */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseP12 } from "../src/certificates/parser.js";
import { RecepcionClient, AutorizacionClient } from "../src/soap/index.js";
import { buildFacturaXml } from "../src/xml/factura.js";
import { signFacturaXml } from "../src/xml/sign.js";

interface SmokeEnv {
  p12Path: string;
  passphrase: string;
  claveAcceso: string;
  recepcionUrl: string;
  autorizacionUrl: string;
}

function readEnv(): SmokeEnv {
  const requireEnv = (k: string): string => {
    const v = process.env[k];
    if (v === undefined || v.length === 0) {
      throw new Error(`[smoke-sri] env ${k} is required`);
    }
    return v;
  };
  return {
    p12Path: requireEnv("SRI_TEST_P12_PATH"),
    passphrase: requireEnv("SRI_TEST_PASSPHRASE"),
    claveAcceso: requireEnv("SRI_TEST_CLAVE_ACCESO"),
    recepcionUrl: requireEnv("SRI_RECEPCION_URL_PRUEBAS"),
    autorizacionUrl: requireEnv("SRI_AUTORIZACION_URL_PRUEBAS"),
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log("[smoke-sri] starting");

  // 1. .p12 → PEM
  const p12Bytes = readFileSync(env.p12Path);
  const parsed = parseP12(p12Bytes, env.passphrase);
  console.log(
    `[smoke-sri] cert parsed; subjectCN=${parsed.subjectCN} expiresAt=${parsed.validTo.toISOString()}`,
  );

  // 2. Build factura from the fixture, swap claveAcceso.
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const fixturePath = resolve(
    __dirname,
    "..",
    "test",
    "fixtures",
    "factura",
    "golden-01.input.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  // Replace claveAcceso (some inputs nest it; the golden fixture has
  // it at top-level under infoTributaria.claveAcceso).
  const infoTributaria = fixture.infoTributaria as Record<string, unknown> | undefined;
  if (infoTributaria !== undefined) {
    infoTributaria.claveAcceso = env.claveAcceso;
  }
  const { xmlForSigning } = buildFacturaXml(fixture);

  // 3. Sign.
  const signed = await signFacturaXml({
    xmlForSigning,
    certificate: {
      certPem: parsed.certPem,
      keyPem: parsed.keyPem,
      expiresAt: parsed.validTo,
    },
  });
  console.log(`[smoke-sri] signed XML produced (${String(signed.signedXml.length)} bytes)`);

  // 4. Recepción.
  const recBaseEnv = {
    SRI_RECEPCION_URL_PRUEBAS: env.recepcionUrl,
    SRI_RECEPCION_URL_PRODUCCION: env.recepcionUrl, // never used — ambiente=1
    SRI_HTTP_TIMEOUT_MS: 30_000,
  };
  const autBaseEnv = {
    SRI_AUTORIZACION_URL_PRUEBAS: env.autorizacionUrl,
    SRI_AUTORIZACION_URL_PRODUCCION: env.autorizacionUrl,
    SRI_HTTP_TIMEOUT_MS: 30_000,
  };
  const rec = new RecepcionClient({ env: recBaseEnv });
  const aut = new AutorizacionClient({ env: autBaseEnv });

  const recResult = await rec.send({ signedXml: Buffer.from(signed.signedXml), ambiente: "1" });
  console.log(
    `[smoke-sri] recepción.estado=${recResult.estado} httpStatus=${String(recResult.httpStatus)} elapsed=${String(recResult.durationMs)}ms`,
  );
  if (recResult.estado !== "RECIBIDA") {
    console.error(
      `[smoke-sri] FAIL: recepción came back ${recResult.estado}; mensajes=${JSON.stringify(
        recResult.mensajes.map((m) => ({ id: m.identificador, tipo: m.tipo })),
      )}`,
    );
    process.exit(1);
  }

  // 5. Poll autorización up to 30 attempts (90 s).
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await new Promise((r) => setTimeout(r, 3_000));
    const autResult = await aut.query({ claveAcceso: env.claveAcceso, ambiente: "1" });
    console.log(
      `[smoke-sri] autorización attempt=${String(attempt)} estado=${autResult.estado} elapsed=${String(autResult.durationMs)}ms`,
    );
    if (autResult.estado === "AUTORIZADO") {
      console.log(
        `[smoke-sri] SUCCESS — numeroAutorizacion=${autResult.numeroAutorizacion ?? "(none)"} fechaAutorizacion=${autResult.fechaAutorizacion ?? "(none)"}`,
      );
      console.log(
        `[smoke-sri] hasAutorizadoXml=${String(autResult.autorizadoXml !== undefined)}`,
      );
      process.exit(0);
    }
    if (autResult.estado === "NO_AUTORIZADO") {
      console.error(
        `[smoke-sri] FAIL: SRI rejected with mensajes=${JSON.stringify(
          autResult.mensajes.map((m) => ({ id: m.identificador, tipo: m.tipo })),
        )}`,
      );
      process.exit(1);
    }
  }

  console.error("[smoke-sri] FAIL: AUTORIZADO not reached within 30 polling attempts");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error("[smoke-sri] FAIL: unexpected error", err);
  process.exit(1);
});
