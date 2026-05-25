/**
 * Tests for the AppError hierarchy. Per TASKS-0006 §1.1 / §1.2.
 *
 * Each subclass propagates its (status, code) defaults; `instanceof AppError`
 * must hold for downstream type narrowing.
 */
import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  BusinessError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  PreconditionRequiredError,
  RateLimitError,
  UpstreamError,
  ValidationError,
} from "./index.js";

describe("AppError base class", () => {
  it("captures message, status, code, detail, errors", () => {
    const err = new AppError("boom", 418, "teapot", {
      detail: "Short and stout",
      errors: [{ identificador: "x", mensaje: "y", tipo: "ERROR" }],
    });
    expect(err.message).toBe("boom");
    expect(err.status).toBe(418);
    expect(err.code).toBe("teapot");
    expect(err.detail).toBe("Short and stout");
    expect(err.errors).toEqual([{ identificador: "x", mensaje: "y", tipo: "ERROR" }]);
    expect(err.name).toBe("AppError");
  });

  it("omits detail and errors when not provided", () => {
    const err = new AppError("bare", 500, "internal.unexpected");
    expect(err.detail).toBeUndefined();
    expect(err.errors).toBeUndefined();
  });

  it("forwards cause via Error.cause", () => {
    const cause = new Error("root");
    const err = new AppError("wrap", 500, "internal.unexpected", { cause });
    expect(err.cause).toBe(cause);
  });

  it("subclass `name` matches the constructor name", () => {
    const err = new ValidationError();
    expect(err.name).toBe("ValidationError");
  });
});

const subclassMatrix: ReadonlyArray<{
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctor: new (...args: any[]) => AppError;
  status: number;
  code: string;
}> = [
  { name: "ValidationError", ctor: ValidationError, status: 400, code: "validation.failed" },
  { name: "AuthError", ctor: AuthError, status: 401, code: "auth.unauthenticated" },
  { name: "ForbiddenError", ctor: ForbiddenError, status: 403, code: "tenant.forbidden" },
  { name: "ConflictError", ctor: ConflictError, status: 409, code: "conflict" },
  {
    name: "PreconditionRequiredError",
    ctor: PreconditionRequiredError,
    status: 412,
    code: "tenant_not_selected",
  },
  { name: "RateLimitError", ctor: RateLimitError, status: 429, code: "rate_limited" },
  { name: "UpstreamError", ctor: UpstreamError, status: 502, code: "upstream_failure" },
  {
    name: "BusinessError",
    ctor: BusinessError,
    status: 422,
    code: "business_rule_violation",
  },
  {
    name: "InternalServerError",
    ctor: InternalServerError,
    status: 500,
    code: "internal.unexpected",
  },
];

describe("AppError subclasses (default status + code)", () => {
  it.each(subclassMatrix)("$name → $status / $code", ({ ctor, status, code }) => {
    const instance = new ctor();
    expect(instance).toBeInstanceOf(AppError);
    expect(instance.status).toBe(status);
    expect(instance.code).toBe(code);
  });
});

describe("NotFoundError", () => {
  it("derives a `${resource}.not_found` code from the resource argument", () => {
    const err = new NotFoundError("invoice");
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("invoice.not_found");
    expect(err.message).toBe("invoice not found");
  });

  it("falls back to `resource.not_found` for an empty string", () => {
    const err = new NotFoundError("");
    expect(err.code).toBe("resource.not_found");
  });

  it("honours an explicit override code", () => {
    const err = new NotFoundError("customer", {}, "customer.unknown");
    expect(err.code).toBe("customer.unknown");
  });
});
