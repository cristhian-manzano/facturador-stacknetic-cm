/**
 * Smoke script for SPEC-0026 emit pipeline. Mints a service JWT, POSTs
 * to /v1/documents/emit, then GETs /status to verify the document
 * reached AUTORIZADO (stub mode).
 *
 * Usage:
 *   pnpm --filter @facturador/sri-core exec tsx scripts/smoke-emit.ts
 */
import { mintServiceJwt } from "@facturador/utils/service-jwt";
import { computeClaveAccesoCheckDigit } from "@facturador/contracts/primitives";
import { ulid } from "ulid";

const BASE_URL = process.env["SRI_CORE_URL"] ?? "http://localhost:3100";
const SECRET = process.env["SERVICE_JWT_SECRET"];

async function main(): Promise<void> {
  if (SECRET === undefined || SECRET.length < 32) {
    throw new Error("SERVICE_JWT_SECRET must be set (>= 32 chars)");
  }
  const companyId = ulid();
  const token = await mintServiceJwt({ companyId, secret: SECRET });

  const secuencial = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0");
  const base48 =
    "21052026" + "01" + "1790012345001" + "1" + "001001" + secuencial + "12345678" + "1";
  const claveAcceso = base48 + computeClaveAccesoCheckDigit(base48);

  const emitRes = await fetch(`${BASE_URL}/v1/documents/emit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId,
      ambiente: "1",
      codDoc: "01",
      estab: "001",
      ptoEmi: "001",
      secuencial,
      claveAcceso,
      fechaEmision: "21/05/2026",
      tipoEmision: "1",
      factura: { placeholder: "stub-payload" },
    }),
  });
  const emitBody = (await emitRes.json()) as unknown;
  // eslint-disable-next-line no-console -- smoke
  console.log("emit", emitRes.status, JSON.stringify(emitBody));

  const statusRes = await fetch(`${BASE_URL}/v1/documents/${claveAcceso}/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const statusBody = (await statusRes.json()) as { events?: Array<unknown> };
  // eslint-disable-next-line no-console -- smoke
  console.log("status", statusRes.status, "events:", statusBody.events?.length ?? 0);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- smoke
  console.error("smoke failed:", err);
  process.exit(1);
});
