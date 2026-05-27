/**
 * `clave-acceso.ts` — print the 49-digit `claveAcceso` for a given tuple.
 *
 * Usage:
 *
 *   pnpm --filter @facturador/sri-core clave-acceso \
 *     --ruc 1791234567001 \
 *     --estab 001 \
 *     --pto 001 \
 *     --secuencial 123 \
 *     --tipo 01 \
 *     [--ambiente 2] \
 *     [--fecha 2025-01-15] \
 *     [--codigo 12345678]
 *
 * All CLI arguments are required except `--ambiente` (default `"2"`,
 * production), `--fecha` (default: today, in Ecuador timezone), and
 * `--codigo` (default: a freshly generated 8-digit numeric).
 *
 * Output: the 49-digit claveAcceso on a single line, suitable for piping
 * into `xargs curl`, copying into a SOAP envelope by hand, or feeding into
 * `apps/sri-core/scripts/smoke-sri.ts` for end-to-end testing.
 *
 * Exit codes:
 *
 *   - `0`: success — stdout carries the claveAcceso.
 *   - `1`: bad arguments — stderr carries a usage line.
 *   - `2`: clave-acceso build failure (e.g. invalid RUC checksum) — stderr
 *     carries the structured error code from `BuildClaveAccesoError`.
 */
import process from "node:process";

import {
  BuildClaveAccesoError,
  buildClaveAcceso,
  generateCodigoNumerico,
} from "@facturador/utils/sri";

interface ParsedArgs {
  ruc?: string;
  estab?: string;
  pto?: string;
  secuencial?: string;
  tipo?: string;
  ambiente?: string;
  fecha?: string;
  codigo?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined) continue;
    switch (name) {
      case "ruc":
        out.ruc = next;
        i++;
        break;
      case "estab":
        out.estab = next;
        i++;
        break;
      case "pto":
      case "ptoEmi":
        out.pto = next;
        i++;
        break;
      case "secuencial":
        out.secuencial = next;
        i++;
        break;
      case "tipo":
      case "codDoc":
        out.tipo = next;
        i++;
        break;
      case "ambiente":
        out.ambiente = next;
        i++;
        break;
      case "fecha":
        out.fecha = next;
        i++;
        break;
      case "codigo":
      case "codigoNumerico":
        out.codigo = next;
        i++;
        break;
      default:
        // Unknown flag — fall through, surfaced as "missing required" if
        // it was a typo for a required one.
        break;
    }
  }
  return out;
}

const USAGE =
  "usage: clave-acceso --ruc <13> --estab <3> --pto <3> --secuencial <9> --tipo <01|04|05|06|07> [--ambiente 1|2] [--fecha YYYY-MM-DD] [--codigo 12345678]";

function isValidTipo(value: string): value is "01" | "04" | "05" | "06" | "07" {
  return value === "01" || value === "04" || value === "05" || value === "06" || value === "07";
}

export function runCli(argv: readonly string[]): { code: number; out: string; err: string } {
  const args = parseArgs(argv);
  const missing: string[] = [];
  if (args.ruc === undefined) missing.push("--ruc");
  if (args.estab === undefined) missing.push("--estab");
  if (args.pto === undefined) missing.push("--pto");
  if (args.secuencial === undefined) missing.push("--secuencial");
  if (args.tipo === undefined) missing.push("--tipo");
  if (missing.length > 0) {
    return { code: 1, out: "", err: `missing: ${missing.join(", ")}\n${USAGE}` };
  }
  // After the `missing` check above, every required field is defined; the
  // local copies narrow `string | undefined` to `string` for the call
  // below. `tipo` is further refined via `isValidTipo` to a string literal.
  const ruc = args.ruc;
  const estab = args.estab;
  const pto = args.pto;
  const secuencial = args.secuencial;
  const tipo = args.tipo;
  if (
    ruc === undefined ||
    estab === undefined ||
    pto === undefined ||
    secuencial === undefined ||
    tipo === undefined
  ) {
    // Unreachable — `missing.length > 0` would already have returned.
    return { code: 1, out: "", err: `missing: ${missing.join(", ")}\n${USAGE}` };
  }
  if (!isValidTipo(tipo)) {
    return {
      code: 1,
      out: "",
      err: `invalid --tipo: ${tipo}. must be one of 01|04|05|06|07`,
    };
  }
  const ambiente = args.ambiente ?? "2";
  if (ambiente !== "1" && ambiente !== "2") {
    return {
      code: 1,
      out: "",
      err: `invalid --ambiente: ${ambiente}. must be 1 (test) or 2 (production)`,
    };
  }

  try {
    const clave = buildClaveAcceso({
      fechaEmision: args.fecha ?? new Date(),
      codDoc: tipo,
      ruc,
      ambiente,
      estab,
      ptoEmi: pto,
      secuencial,
      codigoNumerico: args.codigo ?? generateCodigoNumerico(),
      tipoEmision: "1",
    });
    return { code: 0, out: `${clave}\n`, err: "" };
  } catch (err) {
    if (err instanceof BuildClaveAccesoError) {
      return { code: 2, out: "", err: `${err.code}: ${err.message}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { code: 2, out: "", err: msg };
  }
}

// ---------------------------------------------------------------------------
// CLI entry — runs only when this file is executed directly via `tsx`.
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const result = runCli(process.argv.slice(2));
  if (result.out.length > 0) process.stdout.write(result.out);
  if (result.err.length > 0) process.stderr.write(`${result.err}\n`);
  process.exit(result.code);
}
