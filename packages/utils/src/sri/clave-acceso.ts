/**
 * SRI clave de acceso (49 digits) — generator, validator, módulo-11 helper.
 *
 * Authoritative references:
 *   - `docs/sri-facturacion-electronica-ecuador.md` §4 — composition table
 *     + módulo 11 algorithm reference implementation.
 *   - `ai/specs/0022-clave-acceso-generator.md` — functional contract.
 *   - `ai/plans/0022-clave-acceso-generator-plan.md` §3 — architecture.
 *   - `ai/tasks/0022-clave-acceso-generator-tasks.md` §1 — entry points.
 *
 * Hard rules (enforced here):
 *   - No I/O, no `process.env`, no clock reads, no logging.
 *   - `codigoNumerico` is generated with `crypto.randomInt` — never
 *     `Math.random()` (SPEC-0022 §10 + security.md §4).
 *   - Every public entry point validates its inputs and throws a typed
 *     {@link BuildClaveAccesoError} on malformed input — no silent
 *     coercion, no truncation.
 *
 * Layout (per the SRI doc §4, composition table):
 *
 *   pos 1–8   `ddmmaaaa`             (fechaEmision)
 *   pos 9–10  codDoc                  (01|04|05|06|07)
 *   pos 11–23 ruc                     (13 digits)
 *   pos 24    ambiente                (1|2)
 *   pos 25–27 estab                   (3 digits)
 *   pos 28–30 ptoEmi                  (3 digits)
 *   pos 31–39 secuencial              (9 digits, zero-padded)
 *   pos 40–47 codigoNumerico          (8 digits)
 *   pos 48    tipoEmision             (1)
 *   pos 49    digit verifier          (módulo 11 over the first 48)
 */
import { randomInt } from "node:crypto";

/* -------------------------------------------------------------------------- */
/*                                Constants                                   */
/* -------------------------------------------------------------------------- */

/**
 * Módulo-11 weights for the SRI clave de acceso, applied **right-to-left
 * cyclically** over the 48 base digits.
 *
 * Source: `docs/sri-facturacion-electronica-ecuador.md` §4 ("Algoritmo del
 * dígito verificador — Módulo 11"). Do not duplicate this constant
 * elsewhere — the contracts-side validator re-implements the same
 * algorithm but uses its own constant so the two stay decoupled.
 */
const MODULO_11_WEIGHTS = [2, 3, 4, 5, 6, 7] as const;
const MODULO_11_WEIGHT_COUNT = MODULO_11_WEIGHTS.length;

/** Total length of the base (before appending the check digit). */
const CLAVE_BASE_LENGTH = 48;

/** Total length of a full clave de acceso. */
const CLAVE_TOTAL_LENGTH = 49;

/** Upper bound for `codigoNumerico` (exclusive). Eight digits → [0, 10^8). */
const CODIGO_NUMERICO_UPPER_EXCLUSIVE = 100_000_000;

/** Length of `codigoNumerico` after zero-padding. */
const CODIGO_NUMERICO_LENGTH = 8;

/** Allowed `codDoc` values for v1 (see SPEC-0022 §6.3). */
const ALLOWED_COD_DOC = new Set(["01", "04", "05", "06", "07"]);

/** Allowed `ambiente` values (1 = pruebas, 2 = producción). */
const ALLOWED_AMBIENTE = new Set(["1", "2"]);

/** Currently only the "normal" emisión flow is supported (contingencia is deprecated). */
const ALLOWED_TIPO_EMISION = new Set(["1"]);

/** Pre-compiled regexes — declared once so we don't allocate per call. */
const RE_DIGITS_48 = /^\d{48}$/;
const RE_DIGITS_49 = /^\d{49}$/;
const RE_RUC = /^\d{13}$/;
const RE_ESTAB = /^\d{3}$/;
const RE_PTOEMI = /^\d{3}$/;
const RE_SECUENCIAL_9 = /^\d{9}$/;
const RE_CODIGO_NUM_8 = /^\d{8}$/;
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/* -------------------------------------------------------------------------- */
/*                                  Errors                                    */
/* -------------------------------------------------------------------------- */

/** Discriminated error code returned by {@link BuildClaveAccesoError}. */
export type BuildClaveAccesoErrorCode =
  | "INVALID_FECHA"
  | "INVALID_COD_DOC"
  | "INVALID_RUC"
  | "INVALID_AMBIENTE"
  | "INVALID_ESTAB"
  | "INVALID_PTO_EMI"
  | "INVALID_SECUENCIAL"
  | "INVALID_CODIGO_NUMERICO"
  | "INVALID_TIPO_EMISION"
  | "INVALID_BASE_LENGTH"
  | "INVALID_CHECK_DIGIT";

/**
 * Typed error thrown by {@link buildClaveAcceso} and
 * {@link parseClaveAcceso} when input fails its precondition.
 *
 * Carries a stable `code` for programmatic mapping (e.g. HTTP problem
 * details) plus a short `field` label. Messages never include the offending
 * value verbatim when the value could be PII — only the labels.
 */
export class BuildClaveAccesoError extends Error {
  public readonly code: BuildClaveAccesoErrorCode;
  public readonly field: string;

  public constructor(code: BuildClaveAccesoErrorCode, field: string, message: string) {
    super(message);
    this.name = "BuildClaveAccesoError";
    this.code = code;
    this.field = field;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Public surface                                */
/* -------------------------------------------------------------------------- */

/**
 * Input shape for {@link buildClaveAcceso}.
 *
 * `fechaEmision` may be either:
 *   - a `Date` (caller is responsible for passing a Date that represents
 *     the intended local Ecuadorian date — see SPEC-0022 §6.3 + risks
 *     table for the TZ caveat), or
 *   - a `YYYY-MM-DD` ISO date string (preferred — unambiguous, no TZ
 *     pitfalls).
 *
 * `codigoNumerico` is optional. If omitted, a fresh CSPRNG-generated
 * 8-digit string is used (per FR-4 / SPEC-0022 §6.5). If provided it must
 * be exactly 8 digits.
 */
export interface BuildClaveAccesoInput {
  readonly fechaEmision: Date | string;
  readonly codDoc: "01" | "04" | "05" | "06" | "07";
  readonly ruc: string;
  readonly ambiente: "1" | "2";
  readonly estab: string;
  readonly ptoEmi: string;
  readonly secuencial: string | number;
  readonly codigoNumerico?: string;
  readonly tipoEmision: "1";
}

/* -------------------------------------------------------------------------- */
/*                            Pure utility helpers                            */
/* -------------------------------------------------------------------------- */

/**
 * Compute the módulo-11 check digit for the first 48 base digits of a
 * clave de acceso.
 *
 * Algorithm (docs/sri-facturacion-electronica-ecuador.md §4):
 *   1. Walk `base48` right-to-left.
 *   2. Multiply each digit by `[2,3,4,5,6,7]` cyclically (starting at `2`).
 *   3. Sum the products. Compute `r = 11 - (sum mod 11)`.
 *   4. Special cases:
 *        - `r === 11` (i.e. `sum mod 11 === 0`) → return `"0"`.
 *        - `r === 10` (i.e. `sum mod 11 === 1`) → return `"1"`.
 *        - else                                  → return `String(r)`.
 *
 * Throws via {@link BuildClaveAccesoError} if `base48` is not exactly 48
 * ASCII digit characters (defence-in-depth — the public callers already
 * validate inputs at their boundary, but this helper is exported so it
 * must be robust on its own).
 */
export const computeModulo11 = (base48: string): string => {
  if (base48.length !== CLAVE_BASE_LENGTH || !RE_DIGITS_48.test(base48)) {
    throw new BuildClaveAccesoError(
      "INVALID_BASE_LENGTH",
      "base48",
      `computeModulo11: base must be exactly ${String(CLAVE_BASE_LENGTH)} digits`,
    );
  }
  let sum = 0;
  let widx = 0;
  for (let i = base48.length - 1; i >= 0; i--) {
    // `charAt` always returns a single ASCII digit because `RE_DIGITS_48`
    // guarantees that contract. `Number()` is therefore safe here.
    const digit = Number(base48.charAt(i));
    // `noUncheckedIndexedAccess` forces an explicit `?? 0` fallback even
    // though `widx % 6` is always in-range. Use a typed local to satisfy
    // the rule without disabling it.
    const weight: number = MODULO_11_WEIGHTS[widx] ?? 0;
    sum += digit * weight;
    widx = (widx + 1) % MODULO_11_WEIGHT_COUNT;
  }
  const r = 11 - (sum % 11);
  // Special cases per docs/sri-...§4. Equivalent to `r % 11` but written
  // explicitly to match the SRI reference and ease audit.
  if (r === 11) return "0";
  if (r === 10) return "1";
  return String(r);
};

/**
 * Returns `true` iff `value` is a syntactically valid 49-digit clave de
 * acceso (49 ASCII digits, correct módulo-11 check digit).
 *
 * Never throws; never allocates beyond the regex check and the inner
 * computeModulo11 call.
 */
export const isValidClaveAcceso = (value: string): boolean => {
  if (typeof value !== "string") return false;
  if (value.length !== CLAVE_TOTAL_LENGTH) return false;
  if (!RE_DIGITS_49.test(value)) return false;
  const base = value.slice(0, CLAVE_BASE_LENGTH);
  const verifier = value.slice(CLAVE_BASE_LENGTH);
  // computeModulo11 cannot throw here because `value` already matches
  // /^\d{49}$/, so the first 48 chars are guaranteed digit-only.
  return computeModulo11(base) === verifier;
};

/**
 * SPEC-0022 §6.4-shaped variant of {@link isValidClaveAcceso} that returns
 * an explanatory reason for failures. Provided for callers that need to
 * surface the failure mode (e.g. structured validation responses).
 */
export const validateClaveAcceso = (
  clave: string,
): { ok: true } | { ok: false; reason: string } => {
  if (typeof clave !== "string") return { ok: false, reason: "not a string" };
  if (clave.length !== CLAVE_TOTAL_LENGTH) {
    return { ok: false, reason: `length != ${String(CLAVE_TOTAL_LENGTH)}` };
  }
  if (!RE_DIGITS_49.test(clave)) return { ok: false, reason: "non-digit characters" };
  const base = clave.slice(0, CLAVE_BASE_LENGTH);
  const verifier = clave.slice(CLAVE_BASE_LENGTH);
  return computeModulo11(base) === verifier
    ? { ok: true }
    : { ok: false, reason: "verifier digit mismatch" };
};

/**
 * Strict parse — returns the validated 49-digit string, or throws a
 * {@link BuildClaveAccesoError} explaining what was wrong.
 *
 * Useful for boundary code (e.g. an HTTP route handler that wants to bail
 * with `400` and an error code) without writing a custom `if (!isValid…)`
 * branch every time.
 */
export const parseClaveAcceso = (value: string): string => {
  const result = validateClaveAcceso(value);
  if (!result.ok) {
    const code: BuildClaveAccesoErrorCode =
      result.reason === "verifier digit mismatch" ? "INVALID_CHECK_DIGIT" : "INVALID_BASE_LENGTH";
    throw new BuildClaveAccesoError(code, "claveAcceso", `parseClaveAcceso: ${result.reason}`);
  }
  return value;
};

/**
 * Generate a fresh `codigoNumerico` — exactly 8 ASCII digits, drawn
 * uniformly from `[0, 10^8)` using `crypto.randomInt` (CSPRNG).
 *
 * Never uses `Math.random()` — that would compromise both unpredictability
 * and the spec's collision resistance argument (SPEC-0022 §10 +
 * security.md §4).
 */
export const generateCodigoNumerico = (): string => {
  return randomInt(0, CODIGO_NUMERICO_UPPER_EXCLUSIVE)
    .toString()
    .padStart(CODIGO_NUMERICO_LENGTH, "0");
};

/* -------------------------------------------------------------------------- */
/*                               Build entry                                  */
/* -------------------------------------------------------------------------- */

/**
 * Format `fechaEmision` as `ddmmyyyy` per SRI §4. Accepts a `Date` or a
 * `YYYY-MM-DD` string; throws on either invalid shape or invalid calendar
 * date (e.g. 2026-02-30).
 *
 * For `Date` inputs we read the local components (`getDate()`,
 * `getMonth()`, `getFullYear()`) — caller is responsible for passing a
 * Date already aligned with the Ecuadorian calendar day they intend (see
 * SPEC-0022 §6.3 + risks). For ISO strings, the date is read literally
 * from the lexemes — no TZ math is performed.
 */
const formatFecha = (fecha: Date | string): string => {
  if (typeof fecha === "string") {
    const match = RE_FECHA.exec(fecha);
    if (!match) {
      throw new BuildClaveAccesoError(
        "INVALID_FECHA",
        "fechaEmision",
        "fechaEmision must match YYYY-MM-DD",
      );
    }
    const [, yyyy, mm, dd] = match;
    // Verify the calendar date actually exists — reject 2026-02-30 etc.
    const y = Number(yyyy);
    const mo = Number(mm);
    const d = Number(dd);
    // Construct as a UTC Date to avoid timezone drift; we only need to
    // verify (y, mo, d) round-trip.
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== d
    ) {
      throw new BuildClaveAccesoError(
        "INVALID_FECHA",
        "fechaEmision",
        "fechaEmision is not a real calendar date",
      );
    }
    return `${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}${String(yyyy).padStart(4, "0")}`;
  }
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    throw new BuildClaveAccesoError(
      "INVALID_FECHA",
      "fechaEmision",
      "fechaEmision must be a Date or YYYY-MM-DD string",
    );
  }
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const yyyy = String(fecha.getFullYear()).padStart(4, "0");
  return `${dd}${mm}${yyyy}`;
};

/**
 * Pad a `secuencial` (string or non-negative integer) to exactly 9 ASCII
 * digits. Throws if the input is non-numeric, fractional, negative, or
 * longer than 9 digits after normalisation.
 */
const normaliseSecuencial = (secuencial: string | number): string => {
  let raw: string;
  if (typeof secuencial === "number") {
    if (!Number.isInteger(secuencial) || secuencial < 0) {
      throw new BuildClaveAccesoError(
        "INVALID_SECUENCIAL",
        "secuencial",
        "secuencial must be a non-negative integer",
      );
    }
    raw = String(secuencial);
  } else if (typeof secuencial === "string") {
    if (!/^\d+$/.test(secuencial)) {
      throw new BuildClaveAccesoError(
        "INVALID_SECUENCIAL",
        "secuencial",
        "secuencial must contain only digits",
      );
    }
    raw = secuencial;
  } else {
    throw new BuildClaveAccesoError(
      "INVALID_SECUENCIAL",
      "secuencial",
      "secuencial must be a string or number",
    );
  }
  if (raw.length > 9) {
    throw new BuildClaveAccesoError(
      "INVALID_SECUENCIAL",
      "secuencial",
      "secuencial cannot exceed 9 digits",
    );
  }
  const padded = raw.padStart(9, "0");
  /* v8 ignore start -- defensive postcondition, unreachable when the
     digit-only and ≤9-digit guards above hold (kept for refactor safety). */
  if (!RE_SECUENCIAL_9.test(padded)) {
    throw new BuildClaveAccesoError(
      "INVALID_SECUENCIAL",
      "secuencial",
      "secuencial padding failed",
    );
  }
  /* v8 ignore stop */
  return padded;
};

/**
 * Build a 49-digit SRI clave de acceso from the given fields.
 *
 * Deterministic given a fixed input (including `codigoNumerico`) — when
 * `codigoNumerico` is omitted, a fresh CSPRNG-generated 8-digit number is
 * used and the result is therefore non-deterministic by design.
 *
 * Always validates the assembled 48-digit base length **and** the final
 * 49-digit string round-trip through {@link isValidClaveAcceso} before
 * returning — defence-in-depth against any future refactor introducing a
 * silent off-by-one.
 *
 * @throws {BuildClaveAccesoError} when any field fails its precondition.
 */
export const buildClaveAcceso = (input: BuildClaveAccesoInput): string => {
  // ----- 1) Validate enums and simple shape constraints first.
  if (!ALLOWED_COD_DOC.has(input.codDoc)) {
    throw new BuildClaveAccesoError(
      "INVALID_COD_DOC",
      "codDoc",
      "codDoc must be one of 01, 04, 05, 06, 07",
    );
  }
  if (!ALLOWED_AMBIENTE.has(input.ambiente)) {
    throw new BuildClaveAccesoError("INVALID_AMBIENTE", "ambiente", "ambiente must be '1' or '2'");
  }
  if (!ALLOWED_TIPO_EMISION.has(input.tipoEmision)) {
    throw new BuildClaveAccesoError(
      "INVALID_TIPO_EMISION",
      "tipoEmision",
      "tipoEmision must be '1'",
    );
  }
  if (typeof input.ruc !== "string" || !RE_RUC.test(input.ruc)) {
    throw new BuildClaveAccesoError("INVALID_RUC", "ruc", "ruc must be exactly 13 ASCII digits");
  }
  if (typeof input.estab !== "string" || !RE_ESTAB.test(input.estab)) {
    throw new BuildClaveAccesoError(
      "INVALID_ESTAB",
      "estab",
      "estab must be exactly 3 ASCII digits",
    );
  }
  if (typeof input.ptoEmi !== "string" || !RE_PTOEMI.test(input.ptoEmi)) {
    throw new BuildClaveAccesoError(
      "INVALID_PTO_EMI",
      "ptoEmi",
      "ptoEmi must be exactly 3 ASCII digits",
    );
  }

  // ----- 2) Normalise complex fields.
  const fecha = formatFecha(input.fechaEmision);
  const secuencial = normaliseSecuencial(input.secuencial);

  // codigoNumerico is optional — generate if absent, validate if provided.
  let codigoNumerico: string;
  if (input.codigoNumerico === undefined) {
    codigoNumerico = generateCodigoNumerico();
  } else {
    if (typeof input.codigoNumerico !== "string" || !RE_CODIGO_NUM_8.test(input.codigoNumerico)) {
      throw new BuildClaveAccesoError(
        "INVALID_CODIGO_NUMERICO",
        "codigoNumerico",
        "codigoNumerico must be exactly 8 ASCII digits",
      );
    }
    codigoNumerico = input.codigoNumerico;
  }

  // ----- 3) Assemble the 48-digit base per SRI §4.
  const base48 =
    fecha +
    input.codDoc +
    input.ruc +
    input.ambiente +
    input.estab +
    input.ptoEmi +
    secuencial +
    codigoNumerico +
    input.tipoEmision;

  /* v8 ignore start -- defensive: unreachable when the per-field validators
     above hold; kept so any future refactor that changes a field shape can't
     silently emit a malformed clave. */
  if (base48.length !== CLAVE_BASE_LENGTH || !RE_DIGITS_48.test(base48)) {
    throw new BuildClaveAccesoError(
      "INVALID_BASE_LENGTH",
      "base48",
      `assembled base must be exactly ${String(CLAVE_BASE_LENGTH)} digits`,
    );
  }
  /* v8 ignore stop */

  // ----- 4) Append the módulo-11 check digit.
  const checkDigit = computeModulo11(base48);
  const clave = base48 + checkDigit;

  /* v8 ignore start -- exit-side defence-in-depth: unreachable because
     computeModulo11 is deterministic and the base48 is already validated;
     kept so the function self-asserts its postcondition. */
  if (!isValidClaveAcceso(clave)) {
    throw new BuildClaveAccesoError(
      "INVALID_CHECK_DIGIT",
      "claveAcceso",
      "internal: assembled clave failed self-validation",
    );
  }
  /* v8 ignore stop */

  return clave;
};
