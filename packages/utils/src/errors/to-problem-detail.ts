/**
 * `toProblemDetail` — translate any thrown value into a JSON-serialisable
 * `ProblemDetail` body (RFC 7807-ish; SPEC-0005 §6.6 + SPEC-0006 §6.6).
 *
 * Contract:
 *   - PURE: same input → same output, no clock reads, no I/O.
 *   - SAFE: never throws. If parsing the result against
 *     `ProblemDetailSchema` fails, falls back to a minimal 500 envelope.
 *   - REDACT-SAFE: never copies stack traces, third-party URLs, or arbitrary
 *     properties of `err` into the body. Only `message`, `status`, `code`,
 *     `detail`, and `errors` from a known `AppError` are propagated. A
 *     `ZodError` becomes a 400 with `errors[]` populated from its issues.
 *     Everything else is collapsed to `internal.unexpected` (500).
 *
 * `requestId` (optional) populates `ProblemDetail.instance` and `type`.
 * `type` is the URN `urn:facturador:error:<code>`.
 */
import { ZodError } from "zod";

import { ProblemDetailSchema, type ProblemDetail } from "@facturador/contracts/errors";
import type { SriMensaje } from "@facturador/contracts/errors";

import { AppError } from "./app-error.js";

const TITLE_MAX = 300;
const DETAIL_MAX = 2000;
const MENSAJE_MAX = 1000;

const CODE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const sanitiseCode = (code: string, fallback: string): string =>
  CODE_RE.test(code) ? code : fallback;

const sanitiseTitle = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "Error";
  return truncate(trimmed, TITLE_MAX);
};

const sanitiseDetail = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return truncate(trimmed, DETAIL_MAX);
};

const zodIssuesToMensajes = (err: ZodError): SriMensaje[] => {
  // Stable ordering: by joined path then by message (deterministic for tests).
  const sorted = [...err.issues].sort((a, b) => {
    const pa = a.path.join(".");
    const pb = b.path.join(".");
    if (pa === pb) return a.message.localeCompare(b.message);
    return pa.localeCompare(pb);
  });
  return sorted.map((issue) => {
    const path = issue.path.join(".");
    const identificador = path.length === 0 ? "_root" : path;
    return {
      identificador: truncate(identificador, 20),
      mensaje: truncate(issue.message, MENSAJE_MAX),
      tipo: "ERROR" as const,
    };
  });
};

const buildBody = (
  status: number,
  code: string,
  title: string,
  detail: string | undefined,
  requestId: string | undefined,
  errors: readonly SriMensaje[] | undefined,
): ProblemDetail => {
  const body: ProblemDetail = {
    title: sanitiseTitle(title),
    status,
    code,
    type: `urn:facturador:error:${code}`,
  };
  if (detail !== undefined) body.detail = detail;
  if (requestId !== undefined && requestId.length > 0) {
    body.instance = truncate(requestId, 300);
  }
  if (errors !== undefined && errors.length > 0) body.errors = [...errors];
  return body;
};

export function toProblemDetail(err: unknown, requestId?: string): ProblemDetail {
  let candidate: ProblemDetail;

  if (err instanceof AppError) {
    candidate = buildBody(
      err.status,
      sanitiseCode(err.code, "internal.unexpected"),
      err.message,
      sanitiseDetail(err.detail),
      requestId,
      err.errors,
    );
  } else if (err instanceof ZodError) {
    candidate = buildBody(
      400,
      "validation.failed",
      "Validation failed",
      undefined,
      requestId,
      zodIssuesToMensajes(err),
    );
  } else {
    // Coerce any unknown error to 500 / internal.unexpected. NEVER leak the
    // raw message — it may contain third-party API URLs or stack info. See
    // SPEC-0006 §10 and ai/context/security.md.
    candidate = buildBody(
      500,
      "internal.unexpected",
      "Internal Server Error",
      undefined,
      requestId,
      undefined,
    );
  }

  // Defensive parse: if downstream changes break invariants the schema
  // catches them. The fallback is the absolute-minimum 500 body — the test
  // suite ensures `candidate` always parses, but the fallback keeps the
  // function total ("never throws") for production callers.
  const parsed = ProblemDetailSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return {
    title: "Internal Server Error",
    status: 500,
    code: "internal.unexpected",
    type: "urn:facturador:error:internal.unexpected",
    ...(requestId !== undefined && requestId.length > 0
      ? { instance: truncate(requestId, 300) }
      : {}),
  };
}
