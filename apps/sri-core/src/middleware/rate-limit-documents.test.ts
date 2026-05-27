/**
 * Tests for `buildDocumentsRateLimiter` — per-tenant cap on
 * `POST /v1/documents/*`.
 *
 * Strategy:
 *   - We mount the limiter on a minimal Express app that stamps a fake
 *     `req.service = { companyId }` so the keyer reads a deterministic
 *     identity (no real JWT involved).
 *   - The cap is set to 2 so the third request lands on 429 with the
 *     ProblemDetail body the punchlist requires (code = "auth.rate_limited").
 *   - A second tenant still gets a clean window — keys must be scoped
 *     to `companyId`, not the IP.
 */
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "./error-handler.js";
import { buildDocumentsRateLimiter } from "./rate-limit-documents.js";

function appForCompany(companyId: string, max: number): Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.service = { companyId };
    next();
  });
  app.post("/v1/documents/emit", buildDocumentsRateLimiter({ max }), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe("buildDocumentsRateLimiter", () => {
  it("rejects the 3rd POST with 429 + ProblemDetail code auth.rate_limited (max=2)", async () => {
    const app = appForCompany("01HCOMPANY1", 2);
    const ok1 = await request(app).post("/v1/documents/emit");
    const ok2 = await request(app).post("/v1/documents/emit");
    const blocked = await request(app).post("/v1/documents/emit");
    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("auth.rate_limited");
    expect(blocked.body.status).toBe(429);
  });

  it("keys by companyId — a different tenant's bucket starts at 0", async () => {
    const appA = appForCompany("01HCOMPANY_A", 1);
    await request(appA).post("/v1/documents/emit");
    const blockedA = await request(appA).post("/v1/documents/emit");
    expect(blockedA.status).toBe(429);

    const appB = appForCompany("01HCOMPANY_B", 1);
    const okB = await request(appB).post("/v1/documents/emit");
    expect(okB.status).toBe(200);
  });

  it("skips non-POST methods (GET status routes are unaffected)", async () => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.service = { companyId: "01HCOMPANY1" };
      next();
    });
    app.use(buildDocumentsRateLimiter({ max: 1 }));
    app.get("/v1/documents/abc/status", (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    // Hit the GET many times — the limiter is set to 1 but GETs are skipped.
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).get("/v1/documents/abc/status");
      expect(r.status).toBe(200);
    }
  });
});
