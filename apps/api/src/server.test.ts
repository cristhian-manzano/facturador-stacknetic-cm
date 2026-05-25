/**
 * Unit test for the apps/api /health endpoint.
 *
 * Uses Supertest against the Express factory directly; no port binding.
 * This is the only test required by TASKS-0003 §4.1.
 */

import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type HealthBody } from "./server.js";

describe("GET /health", () => {
  it("returns 200 with the api service payload", async () => {
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.body as HealthBody;
    expect(body).toMatchObject({
      status: "ok",
      service: "api",
    });
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
