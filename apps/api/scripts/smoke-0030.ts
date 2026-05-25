/**
 * Smoke test for PROMPT-0030: create an establecimiento, create an
 * emission point, reserve 10 secuenciales concurrently, observe gapless
 * monotonic counter.
 *
 * Run from `apps/api`:
 *
 *   pnpm exec dotenv -e ../../.env -- tsx scripts/smoke-0030.ts
 *
 * The script uses synthetic ids and cleans up its own rows so re-runs are
 * idempotent.
 */
import { ulid } from "ulid";
import { prisma } from "@facturador/db";
import { reserveSecuencial } from "../src/sequencing/reserve.js";

async function main(): Promise<void> {
  const companyId = ulid();
  const ruc = `9990${Date.now().toString().slice(-9)}001`.slice(0, 13);
  const estabCode = "001";
  const ptoEmiCode = "001";
  const tipoComprobante = "01";

  process.stdout.write(`[smoke-0030] companyId=${companyId} ruc=${ruc}\n`);

  // 1) Bootstrap a Company row so the FK chain (audit etc.) is valid.
  await prisma.company.create({
    data: {
      id: companyId,
      ruc,
      razonSocial: "SMOKE 0030 S.A.",
      ambiente: "1",
      tipoEmision: "1",
      direccionMatriz: "Smoke Test Address",
      obligadoContabilidad: false,
    },
  });

  // 2) Establecimiento + EmissionPoint.
  const estabId = ulid();
  await prisma.establecimiento.create({
    data: {
      id: estabId,
      companyId,
      codigo: estabCode,
      direccion: "Smoke Av. 100",
      isMatriz: true,
    },
  });
  const epId = ulid();
  await prisma.emissionPoint.create({
    data: {
      id: epId,
      companyId,
      establecimientoId: estabId,
      codigo: ptoEmiCode,
      descripcion: "Caja smoke",
      isDefault: true,
    },
  });
  process.stdout.write(
    `[smoke-0030] estab=${estabId} ptoEmi=${epId} (codes ${estabCode}/${ptoEmiCode})\n`,
  );

  // 3) Reserve 10 secuenciales concurrently.
  const N = 10;
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      reserveSecuencial(
        { prisma, maxRetries: 30 },
        { companyId, estab: estabCode, ptoEmi: ptoEmiCode, tipoComprobante },
      ),
    ),
  );
  const elapsedMs = performance.now() - t0;
  const sorted = [...results].sort();
  process.stdout.write(
    `[smoke-0030] N=${N.toString()} unique=${new Set(results).size.toString()} ` +
      `elapsed_ms=${elapsedMs.toFixed(0)} sorted=[${sorted.join(",")}]\n`,
  );

  // 4) Verify the counter row.
  const counter = await prisma.secuencialCounter.findUnique({
    where: {
      companyId_estab_ptoEmi_tipoComprobante: {
        companyId,
        estab: estabCode,
        ptoEmi: ptoEmiCode,
        tipoComprobante,
      },
    },
  });
  process.stdout.write(`[smoke-0030] counter.value=${counter?.value.toString() ?? "<missing>"}\n`);

  // 5) Cleanup — keep the dev DB clean.
  await prisma.secuencialCounter.deleteMany({ where: { companyId } });
  await prisma.emissionPoint.deleteMany({ where: { companyId } });
  await prisma.establecimiento.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  process.stdout.write("[smoke-0030] cleanup done\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`[smoke-0030] FAILED: ${String(err)}\n`);
  process.exitCode = 1;
});
