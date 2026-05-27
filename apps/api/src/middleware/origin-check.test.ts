/**
 * Tests for {@link originCheckMiddleware}.
 *
 * Coverage targets:
 *
 *   - GET/HEAD/OPTIONS pass through with no Origin header.
 *   - POST/PUT/PATCH/DELETE with same-origin Origin → 204 next.
 *   - POST with cross-origin Origin → 403 / `auth.csrf_invalid`.
 *   - POST with no Origin or Referer → 403.
 *   - POST falls back to Referer when Origin is absent.
 *   - Allowlist accepts whitelisted origins.
 *   - `/healthz` + `/readyz` skip the check even on POST.
 */
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "./error-handler.js";
import { originCheckMiddleware } from "./origin-check.js";

function buildApp(allowlist: readonly string[] = []): Express {
  const app = express();
  app.use(originCheckMiddleware({ allowlist }));
  app.get("/r", (_req, res) => res.json({ ok: true }));
  app.post("/r", (_req, res) => res.json({ ok: true }));
  app.put("/r", (_req, res) => res.json({ ok: true }));
  app.patch("/r", (_req, res) => res.json({ ok: true }));
  app.delete("/r", (_req, res) => res.json({ ok: true }));
  app.post("/healthz", (_req, res) => res.json({ ok: true }));
  app.post("/readyz", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("originCheckMiddleware", () => {
  it("passes through GET with no Origin header", async () => {
    const app = buildApp();
    const res = await request(app).get("/r");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("passes through HEAD with no Origin header", async () => {
    const app = buildApp();
    const res = await request(app).head("/r");
    expect(res.status).toBe(200);
  });

  it("passes through OPTIONS with no Origin header", async () => {
    const app = buildApp();
    const res = await request(app).options("/r");
    // Express default 200 for OPTIONS — the middleware did not block.
    expect(res.status).toBeLessThan(400);
  });

  it("accepts POST when Origin matches Host", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://api.example.com");
    expect(res.status).toBe(200);
  });

  it("rejects POST when Origin differs from Host", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.csrf_invalid");
  });

  it("rejects PUT when Origin differs from Host", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(403);
  });

  it("rejects PATCH with mismatched Origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(403);
  });

  it("rejects DELETE with mismatched Origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(403);
  });

  it("rejects POST when both Origin and Referer are absent", async () => {
    const app = buildApp();
    // Supertest sends no Origin by default; explicitly clear Referer too.
    const res = await request(app).post("/r");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.csrf_invalid");
  });

  it("falls back to Referer when Origin is absent", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/r")
      .set("Host", "api.example.com")
      .set("Referer", "http://api.example.com/some/page");
    expect(res.status).toBe(200);
  });

  it("rejects when Referer differs from Host", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/r")
      .set("Host", "api.example.com")
      .set("Referer", "http://attacker.example.com/page");
    expect(res.status).toBe(403);
  });

  it("accepts cross-origin requests on the allowlist", async () => {
    const app = buildApp(["http://app.example.com"]);
    const res = await request(app)
      .post("/r")
      .set("Host", "api.example.com")
      .set("Origin", "http://app.example.com");
    expect(res.status).toBe(200);
  });

  it("skips /healthz even with mismatched Origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/healthz")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(200);
  });

  it("skips /readyz even with mismatched Origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/readyz")
      .set("Host", "api.example.com")
      .set("Origin", "http://attacker.example.com");
    expect(res.status).toBe(200);
  });
});
