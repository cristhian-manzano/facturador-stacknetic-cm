/**
 * Verifies the `createTestApp` factory in this workspace (TASKS-0007 §3.5).
 *
 * Drives `/health` and `/health-db` through Supertest using the factory's
 * isolated Prisma client (from the per-test schema harness) so this test
 * doubles as proof that the harness + factory + Express stack are wired
 * end-to-end:
 *
 *   - GET /health     → 200, `{status: "ok", service: "api"}`.
 *   - GET /health-db  → 200, `{db: "ok"}` (touches the isolated schema).
 *
 * The harness migration is idempotent so the schema we create exposes the
 * same `SELECT 1` semantics as the dev/prod database.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { useTestSchema } from "@facturador/db/test-harness";
import { createTestApp } from "./factory.js";

describe("createTestApp — Supertest smoke", () => {
  const ctx = useTestSchema();

  it("GET /health returns 200 with the api service envelope", async () => {
    const { app } = createTestApp({ prisma: ctx.getPrisma() });
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "api" });
  });

  it("GET /health-db returns 200 against the isolated schema", async () => {
    const { app } = createTestApp({ prisma: ctx.getPrisma() });
    const res = await request(app).get("/health-db");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: "ok" });
  });
});
