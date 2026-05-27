/**
 * Integration test for `GET /health-db`.
 *
 * Drives the Express factory with a real `PrismaClient` (no DI stubs) against
 * the Postgres instance brought up by `docker compose up -d db`. The
 * migrations from `packages/db/prisma/migrations` must already be applied —
 * the test runner does not boot a throwaway schema. The endpoint must
 * answer 200 + `{"db":"ok"}` (SPEC-0004 AC-5).
 */
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "@facturador/db";

import { createApp } from "./server.js";

const prisma = createPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /health-db", () => {
  it("returns 200 with {db:'ok'} when Postgres is reachable", async () => {
    const app = createApp({ prisma });

    const res = await request(app).get("/health-db");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ db: "ok" });
  });
});
