/**
 * Tests for {@link securityHeadersMiddleware}.
 *
 * Coverage targets:
 *
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Cross-Origin-Resource-Policy: same-site
 *   - HSTS is present when `alwaysSetHsts: true` is forced (test env).
 *   - HSTS max-age is overridable via options.
 *   - Custom routes don't lose the headers (idempotent assertion).
 */
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { securityHeadersMiddleware } from "./security-headers.js";

function buildApp(options: Parameters<typeof securityHeadersMiddleware>[0] = {}): Express {
  const app = express();
  app.use(securityHeadersMiddleware(options));
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/r", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("securityHeadersMiddleware", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const app = buildApp();
    const res = await request(app).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const app = buildApp();
    const res = await request(app).get("/healthz");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const app = buildApp();
    const res = await request(app).get("/healthz");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Cross-Origin-Opener-Policy: same-origin", async () => {
    const app = buildApp();
    const res = await request(app).get("/healthz");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  it("sets Cross-Origin-Resource-Policy: same-site", async () => {
    const app = buildApp();
    const res = await request(app).get("/healthz");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
  });

  it("omits HSTS on non-secure dev requests", async () => {
    const app = buildApp();
    // Supertest connects via http and NODE_ENV=test (per vitest setup).
    const res = await request(app).get("/healthz");
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("emits HSTS when alwaysSetHsts: true is forced", async () => {
    const app = buildApp({ alwaysSetHsts: true });
    const res = await request(app).get("/healthz");
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["strict-transport-security"]).toContain("includeSubDomains");
    expect(res.headers["strict-transport-security"]).toContain("preload");
  });

  it("honours a custom HSTS max-age", async () => {
    const app = buildApp({ alwaysSetHsts: true, hstsMaxAgeSeconds: 600 });
    const res = await request(app).get("/healthz");
    expect(res.headers["strict-transport-security"]).toContain("max-age=600");
  });

  it("sets headers on POST responses too", async () => {
    const app = buildApp();
    const res = await request(app).post("/r");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});
