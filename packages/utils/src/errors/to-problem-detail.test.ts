/**
 * Tests for `toProblemDetail`. Per TASKS-0006 §1.3 + SPEC-0006 §AC-1, AC-6.
 *
 * Every branch parses through `ProblemDetailSchema` from contracts — the
 * function returns a valid envelope for every observable input.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProblemDetailSchema } from "@facturador/contracts/errors";
import {
  AuthError,
  BusinessError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  ValidationError,
} from "./index.js";
import { toProblemDetail } from "./to-problem-detail.js";

describe("toProblemDetail — AppError mapping", () => {
  it("AuthError → 401 / auth.unauthenticated; parses through ProblemDetailSchema", () => {
    const body = toProblemDetail(new AuthError(), "01HX8K0PYFA9B7Y1M2N3P4Q5R6");
    expect(body.status).toBe(401);
    expect(body.code).toBe("auth.unauthenticated");
    expect(body.type).toBe("urn:facturador:error:auth.unauthenticated");
    expect(body.instance).toBe("01HX8K0PYFA9B7Y1M2N3P4Q5R6");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("ForbiddenError → 403 / tenant.forbidden", () => {
    const body = toProblemDetail(new ForbiddenError());
    expect(body.status).toBe(403);
    expect(body.code).toBe("tenant.forbidden");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("NotFoundError carries the derived code", () => {
    const body = toProblemDetail(new NotFoundError("invoice"));
    expect(body.status).toBe(404);
    expect(body.code).toBe("invoice.not_found");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("ConflictError default", () => {
    const body = toProblemDetail(new ConflictError("dup", "invoice.duplicate_clave"));
    expect(body.status).toBe(409);
    expect(body.code).toBe("invoice.duplicate_clave");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("RateLimitError default", () => {
    const body = toProblemDetail(new RateLimitError());
    expect(body.status).toBe(429);
    expect(body.code).toBe("rate_limited");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("UpstreamError default", () => {
    const body = toProblemDetail(new UpstreamError("SRI timed out", "sri.network"));
    expect(body.status).toBe(502);
    expect(body.code).toBe("sri.network");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("BusinessError default", () => {
    const body = toProblemDetail(new BusinessError("totals mismatch", "invoice.totals_mismatch"));
    expect(body.status).toBe(422);
    expect(body.code).toBe("invoice.totals_mismatch");
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("ValidationError carries errors[] through to ProblemDetail.errors", () => {
    const body = toProblemDetail(
      new ValidationError("bad body", {
        errors: [{ identificador: "email", mensaje: "Required", tipo: "ERROR" }],
      }),
    );
    expect(body.status).toBe(400);
    expect(body.code).toBe("validation.failed");
    expect(body.errors).toEqual([{ identificador: "email", mensaje: "Required", tipo: "ERROR" }]);
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });
});

describe("toProblemDetail — ZodError mapping", () => {
  it("translates each issue to a SriMensaje with identificador = dotted path", () => {
    const schema = z.object({ email: z.string().email(), age: z.number().int() });
    const result = schema.safeParse({ email: "nope", age: 1.5 });
    expect(result.success).toBe(false);
    if (result.success) return;

    const body = toProblemDetail(result.error);
    expect(body.status).toBe(400);
    expect(body.code).toBe("validation.failed");
    expect(body.errors?.length).toBeGreaterThanOrEqual(2);
    expect(body.errors?.every((m) => m.tipo === "ERROR")).toBe(true);
    expect(body.errors?.map((m) => m.identificador).sort()).toEqual(["age", "email"]);
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("uses `_root` for top-level errors with empty path", () => {
    const schema = z.string();
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (result.success) return;

    const body = toProblemDetail(result.error);
    expect(body.errors?.[0]?.identificador).toBe("_root");
  });

  it("produces a deterministic ordering across calls", () => {
    const schema = z.object({ z: z.string(), a: z.string() });
    const r1 = schema.safeParse({});
    const r2 = schema.safeParse({});
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    if (r1.success || r2.success) return;
    expect(toProblemDetail(r1.error).errors).toEqual(toProblemDetail(r2.error).errors);
  });
});

describe("toProblemDetail — unknown error coercion", () => {
  it("collapses any non-AppError, non-ZodError thrown value to internal.unexpected (500)", () => {
    const body = toProblemDetail(new Error("DB connection refused at pg://internal:5432"));
    expect(body.status).toBe(500);
    expect(body.code).toBe("internal.unexpected");
    expect(body.title).toBe("Internal Server Error");
    expect(body.detail).toBeUndefined();
    expect(ProblemDetailSchema.safeParse(body).success).toBe(true);
  });

  it("does not leak the original message", () => {
    const body = toProblemDetail(new Error("PRIVATE_KEY=abcdef"));
    expect(JSON.stringify(body)).not.toContain("PRIVATE_KEY");
    expect(JSON.stringify(body)).not.toContain("abcdef");
  });

  it("handles primitive throws (string, number, null)", () => {
    expect(toProblemDetail("boom").status).toBe(500);
    expect(toProblemDetail(42).code).toBe("internal.unexpected");
    expect(toProblemDetail(null).code).toBe("internal.unexpected");
    expect(toProblemDetail(undefined).code).toBe("internal.unexpected");
  });
});

describe("toProblemDetail — purity & safety", () => {
  it("returns equal output for equal input (no clock reads)", () => {
    const err = new BusinessError("totals mismatch", "invoice.totals_mismatch", {
      detail: "expected 100.00, got 100.01",
    });
    expect(toProblemDetail(err, "REQ-1")).toEqual(toProblemDetail(err, "REQ-1"));
  });

  it("trims and truncates oversized title to 300 chars", () => {
    const long = "x".repeat(500);
    const body = toProblemDetail(new AuthError(long));
    expect(body.title.length).toBe(300);
  });

  it("omits `instance` when requestId is empty", () => {
    const body = toProblemDetail(new AuthError(), "");
    expect(body.instance).toBeUndefined();
  });
});
