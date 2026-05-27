/**
 * Coverage-focused tests for `validateQuery` and `validateParams`.
 *
 * The server's diag routes only exercise `validateBody`; this file mounts
 * an ad-hoc Express app that uses the other two slices so the workspace
 * meets its function-coverage threshold (TASKS-0007 §6.1, sri-core ≥ 85%
 * lines + ≥ 75% branches — function coverage rolls up the same way).
 */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { validateParams, validateQuery } from "../src/middleware/validate.js";

function buildAppForValidator(mw: express.RequestHandler, route: string): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.get(route, mw, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe("validateQuery / validateParams", () => {
  it("validateQuery returns 400 with a ProblemDetail on a bad query", async () => {
    const app = buildAppForValidator(
      validateQuery(z.object({ page: z.coerce.number().int().positive() })),
      "/echo",
    );
    const res = await request(app).get("/echo?page=notanumber");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "validation.failed" });
  });

  it("validateQuery sorts multiple issues deterministically", async () => {
    // Two issues at different paths so the path-sort branch fires.
    const app = buildAppForValidator(
      validateQuery(
        z.object({
          a: z.string().min(1, "missing-a"),
          b: z.string().min(1, "missing-b"),
        }),
      ),
      "/multi",
    );
    const res = await request(app).get("/multi");
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
    // Deterministic order: a before b.
    expect(res.body.errors[0].identificador).toBe("a");
    expect(res.body.errors[1].identificador).toBe("b");
  });

  it("validateQuery sorts issues at the same path by message", async () => {
    // Two issues at the same path → secondary sort by message kicks in.
    const app = buildAppForValidator(
      validateQuery(
        z.object({
          q: z
            .string()
            .min(3, "zzz too-short")
            .regex(/^[A-Z]+$/, "aaa must be uppercase"),
        }),
      ),
      "/dup",
    );
    const res = await request(app).get("/dup?q=ab");
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
    // Both have identificador "q"; messages sort alphabetically — "aaa..." first.
    expect(res.body.errors[0].mensaje).toMatch(/^aaa/);
    expect(res.body.errors[1].mensaje).toMatch(/^zzz/);
  });

  it("validateParams returns 400 on a bad route param", async () => {
    const app = buildAppForValidator(
      validateParams(z.object({ id: z.string().regex(/^[A-Z0-9]{26}$/) })),
      "/items/:id",
    );
    const res = await request(app).get("/items/abc");
    expect(res.status).toBe(400);
  });

  it("validateParams passes through on a valid ULID-shaped param", async () => {
    const app = buildAppForValidator(
      validateParams(z.object({ id: z.string().regex(/^[A-Z0-9]{26}$/) })),
      "/items/:id",
    );
    // Exactly 26 characters of Crockford-base32-friendly content.
    const ulid26 = "01J7ZZ00000000000000000000";
    const res = await request(app).get(`/items/${ulid26}`);
    expect(res.status).toBe(200);
  });
});
