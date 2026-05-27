/**
 * Tests for `/readyz` polling staleness extension.
 *
 * Covers audit-punchlist Item 12 (REVIEW-0026 §10 #4):
 *   - Fresh batch (≤ 5 min ago) → 200 + `polling: "ok"`.
 *   - Stale batch (> 5 min ago) → 503 + `polling: "stale"`.
 *   - Uninitialised (no batch yet) → 200 + `polling: "uninitialized"`.
 */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createPollingHealth,
  POLLING_STALENESS_THRESHOLD_MS,
} from "../jobs/polling-health.js";

import { buildHealthRouter } from "./health.js";

const fakePrisma = {
  $queryRaw: () => Promise.resolve([{ ok: 1 }]),
} as unknown as import("@facturador/db").PrismaClient;

function appWith(pollingHealth: ReturnType<typeof createPollingHealth>, nowMs: () => number) {
  const app = express();
  app.use(buildHealthRouter({ prisma: fakePrisma, pollingHealth, nowMs }));
  return app;
}

describe("GET /readyz — polling staleness", () => {
  it("200 + polling=ok when the last batch completed within 5 minutes", async () => {
    const ph = createPollingHealth();
    const fixedNow = 10_000_000;
    ph.recordBatchCompleted(fixedNow - 60_000); // 1 minute ago
    const app = appWith(ph, () => fixedNow);
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ready",
      db: "ok",
      polling: "ok",
    });
  });

  it("503 + polling=stale when the last batch is older than 5 minutes", async () => {
    const ph = createPollingHealth();
    const fixedNow = 10_000_000;
    // Step 1 ms past the staleness threshold so the check trips.
    ph.recordBatchCompleted(fixedNow - POLLING_STALENESS_THRESHOLD_MS - 1);
    const app = appWith(ph, () => fixedNow);
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "down",
      db: "ok",
      polling: "stale",
    });
  });

  it("200 + polling=uninitialized when no batch has completed yet", async () => {
    const ph = createPollingHealth();
    const fixedNow = 10_000_000;
    const app = appWith(ph, () => fixedNow);
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ready",
      db: "ok",
      polling: "uninitialized",
    });
  });

  it("falls back to DB-only readiness when no polling state is wired", async () => {
    const app = express();
    app.use(buildHealthRouter({ prisma: fakePrisma }));
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", db: "ok" });
  });
});
