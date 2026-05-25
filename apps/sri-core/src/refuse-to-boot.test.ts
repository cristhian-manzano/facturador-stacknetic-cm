/**
 * `refuse-to-boot` — spawns the sri-core boot entrypoint with
 * `NODE_ENV=production` + `SRI_STUB_MODE=true` and asserts it exits with
 * a non-zero status and a message containing `stub_mode_in_production`.
 *
 * Hard rule from PROMPT-0020: sri-core MUST refuse to boot when stub mode
 * is enabled in production. This test is the durable proof.
 *
 * The test runs `tsx src/index.ts` directly so we exercise the real env
 * loader, not a stub. Stdin/stdout/stderr are captured. The spawn is
 * cheap (≤ 1.5 s on a cold cache).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRI_CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("sri-core refuses to boot in production with stub mode", () => {
  it("exits non-zero and prints stub_mode_in_production", () => {
    let stderr = "";
    let stdout = "";
    let exitCode = 0;
    try {
      execFileSync("pnpm", ["exec", "tsx", "src/index.ts"], {
        cwd: SRI_CORE_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          LOG_LEVEL: "info",
          SRI_CORE_PORT: "3199",
          // Provide enough valid fields that ONLY the stub-mode refine fires.
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
          SERVICE_JWT_SECRET: "x".repeat(48),
          SRI_RECEPCION_URL_PRUEBAS: "https://celcer.sri.gob.ec/recepcion",
          SRI_AUTORIZACION_URL_PRUEBAS: "https://celcer.sri.gob.ec/autorizacion",
          SRI_RECEPCION_URL_PRODUCCION: "https://cel.sri.gob.ec/recepcion",
          SRI_AUTORIZACION_URL_PRODUCCION: "https://cel.sri.gob.ec/autorizacion",
          SRI_CERT_MASTER_KEY_HEX: "0".repeat(64),
          SRI_STUB_MODE: "true",
        },
        stdio: "pipe",
        timeout: 8_000,
      });
    } catch (err) {
      const e = err as { status: number | null; stdout?: Buffer; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stdout = e.stdout?.toString("utf8") ?? "";
      stderr = e.stderr?.toString("utf8") ?? "";
    }
    expect(exitCode).not.toBe(0);
    expect(`${stderr}${stdout}`).toContain("stub_mode_in_production");
  }, 15_000);
});
